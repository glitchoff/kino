import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { compile } from "./compile.js";
import { scratchDir } from "./scratch.js";
import { resolveTtsTracks, compositionHasTts } from "../tts/resolve.js";
import { renderTakumiElements } from "./elements/takumi-elements.js";
import { extractKino, readKinoManifest } from "../artifact/index.js";
import { renderSegmented } from "./render-segmented.js";
import {
  getFFmpegBinaryPath,
  detectBestEncoder,
  assertDrawtextSupport,
} from "../encoder/index.js";
import type { KinoComposition, RenderOptions, VideoEncoder } from "../types/index.js";

function spawnFFmpegProcess(
  ffmpegBin: string,
  args: string[],
  verbose?: boolean,
  cwd?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegBin, args, { stdio: verbose ? "inherit" : "pipe", cwd });

    let stderr = "";
    if (!verbose && proc.stderr) {
      proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    }

    proc.on("error", (err) => {
      reject(new Error(`Failed to start FFmpeg process (${ffmpegBin}). Error: ${err.message}`));
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}.\n${stderr ? `FFmpeg output:\n${stderr}` : ""}`));
      }
    });
  });
}

/** What a render produced. The cache fields are absent when `cache` is off. */
export interface RenderResult {
  output: string;
  /** Segments reused from a previous cached render. */
  reused?: number;
  /** Segments rendered this run. */
  rendered?: number;
}

export async function render(
  compositionOrKinoPath: KinoComposition | string,
  options: RenderOptions
): Promise<RenderResult> {
  const ffmpegBin = getFFmpegBinaryPath(options.ffmpegPath);

  let requestedEncoder: VideoEncoder | undefined = options.encoder;
  if (requestedEncoder === "auto" || requestedEncoder === undefined) {
    requestedEncoder = (await detectBestEncoder(ffmpegBin)) as VideoEncoder;
    if (requestedEncoder !== "libx264") {
      console.log(`[kino] auto: using hardware encoder '${requestedEncoder}'`);
    }
  }
  const renderOptions = { ...options, encoder: requestedEncoder };

  let kinoPath: string;
  let ownsKinoFile = false;
  // Set when the input was a composition; reused by the encoder fallback so it
  // recompiles the TTS-resolved version rather than the original.
  let resolvedComposition: KinoComposition | undefined;

  if (typeof compositionOrKinoPath === "string") {
    kinoPath = compositionOrKinoPath;
    if (!existsSync(kinoPath)) {
      throw new Error(`.kino file not found: ${kinoPath}`);
    }
  } else {
    let composition = compositionOrKinoPath;
    // TTS is synthesised up front: compile() is synchronous and only ever sees
    // real WAV paths.
    if (compositionHasTts(composition)) {
      composition = await resolveTtsTracks(composition);
    }
    resolvedComposition = composition;
    await assertDrawtextSupport(ffmpegBin, composition);

    // Incremental rendering: when the caller asked for the cache, render scene
    // segments and join them. Only reached for a composition â€” a pre-built
    // `.kino` is a single artifact with no scene boundaries left.
    if (options.cache) {
      const cacheDir = options.cacheDir ?? join(dirname(resolve(options.output)), ".kino-cache");
      const result = renderSegmented(composition, renderOptions, cacheDir);
      console.log(
        `[kino] cached render: ${result.reused} segment(s) reused, ${result.rendered} rendered`
      );
      return { output: result.output, reused: result.reused, rendered: result.rendered };
    }

    // `tak:` markup is rendered here because compile() is synchronous and
    // Takumi is not. Elements without the prefix still go to a browser inside
    // compile().
    const takumiRenders = await renderTakumiElements(composition);
    if (options.unsafeInlineText) {
      console.warn(
        "[kino] Warning: unsafeInlineText disables textfile delivery; text with apostrophes may render blank on some platforms."
      );
    }
    const kinoDir = scratchDir("kino-", { outputPath: options.output });
    kinoPath = join(kinoDir, "composition.kino");
    ownsKinoFile = true;
    try {
      compile(composition, { ...renderOptions, kinoPath, takumiRenders });
    } catch (err) {
      rmSync(kinoDir, { recursive: true, force: true });
      throw err;
    }
  }

  const extractionDir = scratchDir("kino-extract-", { outputPath: options.output });
  try {
    extractKino(kinoPath, extractionDir);
    const manifest = readKinoManifest(kinoPath);
    const finalOutput = resolve(options.output);
    const args = [...manifest.ffmpegArgs.slice(0, -1), finalOutput];

    const spawnWith = (spawnArgs: string[]) => {
      if (options.verbose) {
        console.log(`[kino] Spawning: ${ffmpegBin} ${spawnArgs.join(" ")}`);
      }
      return spawnFFmpegProcess(ffmpegBin, spawnArgs, options.verbose, extractionDir);
    };

    try {
      await spawnWith(args);
      return { output: options.output };
    } catch (err: any) {
      const reqEncoder = renderOptions.encoder;
      if (reqEncoder && reqEncoder !== "libx264") {
        console.warn(
          `[kino] GPU encoder '${reqEncoder}' failed or unavailable on host system. Automatically falling back to universal CPU encoder 'libx264'...`
        );
        if (typeof compositionOrKinoPath === "string") {
          throw err;
        }
        const fbKinoDir = scratchDir("kino-", { outputPath: options.output });
        try {
          const fbKinoPath = join(fbKinoDir, "composition.kino");
          compile(resolvedComposition ?? compositionOrKinoPath, {
            ...options,
            encoder: "libx264",
            kinoPath: fbKinoPath,
          });
          const fbManifest = readKinoManifest(fbKinoPath);
          const fbArgs = [...fbManifest.ffmpegArgs.slice(0, -1), options.output];
          if (options.verbose) {
            console.log(`[kino] Fallback spawning: ${ffmpegBin} ${fbArgs.join(" ")}`);
          }
          await spawnFFmpegProcess(ffmpegBin, fbArgs, options.verbose, extractionDir);
          return { output: options.output };
        } finally {
          rmSync(fbKinoDir, { recursive: true, force: true });
        }
      }
      throw err;
    }
  } finally {
    try {
      rmSync(extractionDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
    if (ownsKinoFile) {
      try {
        rmSync(dirname(kinoPath), { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }
}
