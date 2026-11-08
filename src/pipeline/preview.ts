import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { KinoComposition } from "../types/index.js";
import { compile } from "./compile.js";
import { extractKino, readKinoManifest } from "../artifact/kino.js";
import { getFFmpegBinaryPath } from "../encoder/probe.js";
import { renderTakumiElements } from "./elements/takumi-elements.js";

/**
 * A preview session: compile once, then pull frames on demand.
 *
 * A one-shot still costs ~65ms, almost all of it process spawn and decode. A
 * session amortises the compile and, more importantly, renders the composition
 * to a small proxy file first — seeking that is ~23ms per frame, and scrubbing
 * forward through it is cheaper still.
 *
 * The proxy is deliberately lossy and small: a preview is for judging layout and
 * timing, not colour. Render for real with `render()` when it looks right.
 */
export interface PreviewOptions {
  /** Height of the proxy, in pixels. Width follows the aspect ratio. Default 360. */
  height?: number;
  /** Output format for `frame()`. PNG is lossless and larger; JPEG is smaller. Default png. */
  format?: "png" | "jpg";
  /** Override the ffmpeg binary. */
  ffmpegPath?: string;
}

export interface PreviewFrame {
  /** Timestamp requested, in seconds. */
  at: number;
  /** PNG or JPEG bytes. */
  data: Buffer;
  /** `data:` URL, ready to hand to a vision model or an `<img>`. */
  url: string;
  /** How long this frame took, in milliseconds. */
  ms: number;
}

export class Preview {
  private constructor(
    private readonly proxyPath: string,
    private readonly dir: string,
    private readonly duration: number,
    private readonly fps: number,
    private readonly format: "png" | "jpg",
    private readonly ffmpeg: string
  ) {}

  /** Build a preview for a composition. Compiles and renders the proxy once. */
  static async open(
    composition: KinoComposition,
    options: PreviewOptions = {}
  ): Promise<Preview> {
    const ffmpeg = getFFmpegBinaryPath(options.ffmpegPath);
    const dir = mkdtempSync(join(tmpdir(), "kino-preview-"));

    try {
      const takumiRenders = await renderTakumiElements(composition);
      const height = options.height ?? 360;
      // `preview` bakes the downscale into the filtergraph and switches the
      // encoder to ultrafast/CRF 30 — exactly the proxy this needs. Adding a
      // `-vf` on top is not possible: the compiled args already use
      // `-filter_complex`, and ffmpeg refuses simple and complex filtering on
      // the same stream.
      const kino = compile(composition, {
        output: join(dir, "full.mp4"),
        takumiRenders,
        preview: height,
      });

      // Read the manifest straight from the archive; extracting is only needed
      // for the assets, and ffmpeg is pointed at the extracted directory.
      const manifest = readKinoManifest(kino.kinoFilePath);
      const extractDir = join(dir, "extract");
      extractKino(kino.kinoFilePath, extractDir);
      // Compiled args end with the output path; everything before is inputs and
      // the filtergraph.
      const graphArgs = manifest.ffmpegArgs.slice(0, -1);

      const proxyPath = join(dir, "proxy.mp4");
      await run(ffmpeg, [
        "-hide_banner", "-loglevel", "error", "-y",
        ...graphArgs,
        // All-keyframes: every seek lands on an exact frame instead of decoding
        // forward from the previous one, which is the whole point of the proxy.
        "-g", "1",
        proxyPath,
      ], extractDir);

      // Duration comes from the normalized composition; asking ffprobe would be
      // another process for a number we already have.
      const { normalizeComposition } = await import("../normalize/composition.js");
      const norm = normalizeComposition(composition);
      return new Preview(
        proxyPath,
        dir,
        norm.duration,
        norm.fps,
        options.format ?? "png",
        ffmpeg
      );
    } catch (err) {
      rmSync(dir, { recursive: true, force: true });
      throw err;
    }
  }

  /** Duration of the composition, in seconds. */
  get length(): number {
    return this.duration;
  }

  /** Frame rate of the composition. */
  get frameRate(): number {
    return this.fps;
  }

  /**
   * Render one frame at `at` seconds.
   *
   * Seeks the proxy, so cost is flat rather than proportional to the timestamp.
   */
  async frame(at: number): Promise<PreviewFrame> {
    const t0 = Date.now();
    const clamped = Math.max(0, Math.min(this.duration - 1 / this.fps, at));
    const mime = this.format === "jpg" ? "image/jpeg" : "image/png";

    const data = await run(this.ffmpeg, [
      "-hide_banner", "-loglevel", "error",
      "-ss", String(clamped),
      "-i", this.proxyPath,
      "-frames:v", "1",
      "-f", "image2pipe", "-vcodec", this.format === "jpg" ? "mjpeg" : "png",
      "-",
    ]);

    return {
      at: clamped,
      data,
      url: `data:${mime};base64,${data.toString("base64")}`,
      ms: Date.now() - t0,
    };
  }

  /** Render several frames, reusing the session. */
  async frames(timestamps: number[]): Promise<PreviewFrame[]> {
    const out: PreviewFrame[] = [];
    for (const t of timestamps) out.push(await this.frame(t));
    return out;
  }

  /** Delete the proxy and temporary files. */
  close(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

/**
 * Run ffmpeg, collecting stdout as bytes.
 *
 * `cwd` matters: compiled arguments reference assets by bare filename, so
 * ffmpeg has to run from the directory they were staged into.
 */
function run(bin: string, args: string[], cwd?: string): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, args, cwd ? { cwd } : undefined);
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exited ${code}.${stderr.trim() ? `\n${stderr.trim()}` : ""}`));
    });
  });
}

/** Convenience wrapper: open, pull frames, close. */
export async function previewFrames(
  composition: KinoComposition,
  timestamps: number[],
  options: PreviewOptions = {}
): Promise<PreviewFrame[]> {
  const preview = await Preview.open(composition, options);
  try {
    return await preview.frames(timestamps);
  } finally {
    preview.close();
  }
}


