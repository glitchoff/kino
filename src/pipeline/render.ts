import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { compile } from "./compile.js";
import { extractKino, readKinoManifest } from "../artifact/index.js";
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

export async function render(
  compositionOrKinoPath: KinoComposition | string,
  options: RenderOptions
): Promise<{ output: string }> {
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

  if (typeof compositionOrKinoPath === "string") {
    kinoPath = compositionOrKinoPath;
    if (!existsSync(kinoPath)) {
      throw new Error(`.kino file not found: ${kinoPath}`);
    }
  } else {
    const composition = compositionOrKinoPath;
    await assertDrawtextSupport(ffmpegBin, composition);
    if (options.unsafeInlineText) {
      console.warn(
        "[kino] Warning: unsafeInlineText disables textfile delivery; text with apostrophes may render blank on some platforms."
      );
    }
    const kinoDir = mkdtempSync(join(tmpdir(), "kino-"));
    kinoPath = join(kinoDir, "composition.kino");
    ownsKinoFile = true;
    try {
      compile(composition, { ...renderOptions, kinoPath });
    } catch (err) {
      rmSync(kinoDir, { recursive: true, force: true });
      throw err;
    }
  }

  const extractionDir = mkdtempSync(join(tmpdir(), "kino-extract-"));
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
        const fbKinoDir = mkdtempSync(join(tmpdir(), "kino-"));
        try {
          const fbKinoPath = join(fbKinoDir, "composition.kino");
          compile(compositionOrKinoPath, { ...options, encoder: "libx264", kinoPath: fbKinoPath });
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
