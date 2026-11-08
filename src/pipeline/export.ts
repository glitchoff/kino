import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { compile } from "./compile.js";
import { extractKino, readKinoManifest } from "../artifact/kino.js";
import { getFFmpegBinaryPath } from "../encoder/probe.js";
import type { KinoComposition } from "../types/index.js";
import { normalizeComposition } from "../normalize/composition.js";
import type { FrameRequest, FrameResult, ExportOptions, ExportResult } from "../types/export.js";

/** Runs ffmpeg and rejects with its stderr on a non-zero exit. */
function runFFmpeg(
  bin: string,
  args: string[],
  cwd: string,
  verbose: boolean
): Promise<void> {
  return new Promise((done, fail) => {
    const proc = spawn(bin, args, { cwd, stdio: verbose ? "inherit" : "pipe" });
    let stderr = "";
    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", fail);
    proc.on("close", (code) => {
      if (code === 0) done();
      else fail(new Error(`ffmpeg exited ${code}.${stderr.trim() ? `\n${stderr.trim()}` : ""}`));
    });
  });
}

/**
 * Export a composition in whichever forms you ask for.
 *
 * Every output is independent. Asking only for `frames` compiles and seeks but
 * never encodes, so it is cheap enough to call in a feedback loop.
 *
 * Efficiency: the composition is compiled **once** and the staged assets are
 * shared by every output. `video` and `preview` still need one ffmpeg run each,
 * because a preview is a different filtergraph and encoder setting — there is
 * no single invocation that produces both correctly.
 *
 * ```ts
 * const { frames } = await kino.export(comp, { frames: [0, 1.5, 3] });
 * frames[0].path   // "…/frame-0.png"
 * frames[0].data   // "data:image/png;base64,…"
 * ```
 */
export async function exportComposition(
  compositionOrKinoPath: KinoComposition | string,
  options: ExportOptions
): Promise<ExportResult> {
  const wantsFrames = !!options.frames?.length;
  const wantsVideo = !!options.video;
  const wantsPreview = !!options.preview;

  if (wantsFrames && typeof compositionOrKinoPath === "string") {
    throw new Error(
      "frames require a composition, not a .kino path — a compiled artifact cannot be seeked by scene."
    );
  }

  const result: ExportResult = {};
  if (!wantsFrames && !wantsVideo && !wantsPreview) return result;

  const ffmpegBin = getFFmpegBinaryPath(options.ffmpegPath);

  // Compile once for everything. The full-quality build is reused for frames
  // and for the video; only the preview needs its own compile, because its
  // downscale is baked into the filtergraph.
  const sharedKino = compile(compositionOrKinoPath as KinoComposition, {
    ...options,
    preview: false,
  }).kinoFilePath;

  try {
    if (wantsFrames) {
      result.frames = await extractFrames(
        sharedKino,
        options.frames!,
        ffmpegBin,
        options,
        // Scenes carry the length; there is no top-level duration to read.
        normalizeComposition(compositionOrKinoPath as KinoComposition)
      );
    }

    if (wantsVideo) {
      result.video = await runFromKino(sharedKino, options.video!, ffmpegBin, options);
    }

    if (wantsPreview) {
      // Its own compile: the preview scale lives in the graph.
      const previewKino = compile(compositionOrKinoPath as KinoComposition, {
        ...options,
        preview: options.preview,
      }).kinoFilePath;
      try {
        result.preview = await runFromKino(
          previewKino,
          options.previewOutput ?? "preview.mp4",
          ffmpegBin,
          options
        );
      } finally {
        rmSync(previewKino, { force: true });
      }
    }
  } finally {
    rmSync(sharedKino, { force: true });
  }

  return result;
}

/** Renders a compiled artifact to `output`. */
async function runFromKino(
  kinoPath: string,
  output: string,
  ffmpegBin: string,
  options: ExportOptions
): Promise<string> {
  const extractionDir = mkdtempSync(join(tmpdir(), "kino-export-"));
  try {
    extractKino(kinoPath, extractionDir);
    const manifest = readKinoManifest(kinoPath);
    const finalOutput = resolve(output);
    await runFFmpeg(
      ffmpegBin,
      [...manifest.ffmpegArgs.slice(0, -1), finalOutput],
      extractionDir,
      !!options.verbose
    );
    return finalOutput;
  } finally {
    rmSync(extractionDir, { recursive: true, force: true });
  }
}

/**
 * Writes one still per requested timestamp.
 *
 * ffmpeg seeks to each timestamp on the same filtergraph the video would use,
 * takes a single frame and skips the encoder, so a still costs a seek rather
 * than a render and is exactly what the video shows at that moment.
 */
async function extractFrames(
  kinoPath: string,
  requests: FrameRequest[],
  ffmpegBin: string,
  options: ExportOptions,
  timing?: { duration: number; fps: number }
): Promise<FrameResult[]> {
  const extractionDir = mkdtempSync(join(tmpdir(), "kino-frames-"));
  try {
    extractKino(kinoPath, extractionDir);
    const manifest = readKinoManifest(kinoPath);
    // Compiled args end with the output path; the rest is the input graph.
    const graphArgs = manifest.ffmpegArgs.slice(0, -1);

    const results: FrameResult[] = [];
    for (const request of requests) {
      const at = typeof request === "number" ? request : request.at;
      const name =
        typeof request === "number"
          ? `frame-${String(at).replace(".", "_")}`
          : request.name ?? `frame-${String(at).replace(".", "_")}`;
      const format = typeof request === "number" ? "png" : request.format ?? "png";
      const outPath = resolve(options.frameDir ?? ".", `${name}.${format}`);

      // Clamp to just inside the composition. A seek at exactly the duration
      // produces no frame — ffmpeg exits 0 and writes nothing — so asking for
      // the last instant would otherwise fail with ENOENT.
      // Clamp to the last whole frame inside the composition. A seek at or
      // past the duration produces no frame — ffmpeg exits 0 and writes
      // nothing — and so does a seek between frames, so subtract a frame
      // rather than an arbitrary epsilon.
      const duration = timing?.duration ?? NaN;
      const fps = timing?.fps || 30;
      const seekTo =
        Number.isFinite(duration) && duration > 0 && at >= duration
          ? Math.max(0, duration - 1 / fps)
          : at;

      // `-ss` must come *after* the inputs here. The background is a lavfi
      // `color=...:d=N` generator, which cannot be seeked: as an input option
      // ffmpeg silently produces from t=0 and `-frames:v 1` captures the first
      // frame, so every still showed t=0 and animations looked frozen. As an
      // output option the filtergraph runs to `at` and the frame is dropped
      // downstream, which is what a still needs.
      await runFFmpeg(
        ffmpegBin,
        ["-hide_banner", "-loglevel", "error", "-y", ...graphArgs, "-ss", String(seekTo), "-frames:v", "1", outPath],
        extractionDir,
        !!options.verbose
      );

      if (!existsSync(outPath)) {
        throw new Error(
          `No frame at ${at}s. The composition may be shorter than that; seek a timestamp inside its duration.`
        );
      }

      const bytes = readFileSync(outPath);
      const mime = format === "jpg" || format === "jpeg" ? "image/jpeg" : "image/png";
      results.push({
        at,
        path: outPath,
        data: `data:${mime};base64,${bytes.toString("base64")}`,
      });
    }
    return results;
  } finally {
    rmSync(extractionDir, { recursive: true, force: true });
  }
}
