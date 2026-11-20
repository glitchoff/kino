import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { KinoComposition } from "../types/index.js";
import { compile } from "./compile.js";
import { extractKino, readKinoManifest } from "../artifact/kino.js";
import { getFFmpegBinaryPath } from "../encoder/probe.js";
import { renderTakumiElements } from "./elements/takumi-elements.js";
import { FrameCache } from "./frame-cache.js";
import { resolveTtsTracks, compositionHasTts } from "../tts/resolve.js";

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
  /**
   * RAM budget for the decoded frame cache, in megabytes. Default 512.
   *
   * Frames are decoded once into memory, which makes a seek an array lookup
   * (~0.0004 ms) instead of a process spawn (~640 ms on Windows). The budget
   * caps how much of the clip is resident: a clip whose raw frames exceed it
   * keeps the first part in RAM and seeks the proxy file for the rest.
   *
   * Set to 0 to disable the cache entirely.
   */
  frameCacheMB?: number;
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
  private cache?: FrameCache;
  private cachePromise?: Promise<FrameCache | undefined>;
  private readonly cacheBytes: number;
  private readonly width: number;
  private readonly height: number;

  private constructor(
    private readonly proxyPath: string,
    private readonly dir: string,
    private readonly duration: number,
    private readonly fps: number,
    private readonly format: "png" | "jpg",
    private readonly ffmpeg: string,
    width: number,
    height: number,
    frameCacheMB: number
  ) {
    this.width = width;
    this.height = height;
    this.cacheBytes = Math.max(0, frameCacheMB) * 1024 * 1024;
  }

  /** Build a preview for a composition. Compiles and renders the proxy once. */
  static async open(
    compositionOrSpec: KinoComposition,
    options: PreviewOptions = {}
  ): Promise<Preview> {
    const ffmpeg = getFFmpegBinaryPath(options.ffmpegPath);
    const dir = mkdtempSync(join(tmpdir(), "kino-preview-"));

    try {
      // TTS is synthesised up front, exactly as `render()` does: `compile()` is
      // synchronous and `prestageRemoteAssets` expects every `src` to be a path.
      // A raw TTS spec object reaches it otherwise and `src.startsWith` throws —
      // which is what made every `voice()` composition fail to preview.
      let composition = compositionOrSpec;
      if (compositionHasTts(composition)) {
        composition = await resolveTtsTracks(composition);
      }

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
      // Proxy dimensions: the compiled graph scales to `height`, width follows
      // the composition's aspect ratio, both rounded to even pixels by ffmpeg.
      const proxyHeight = height;
      const proxyWidth = Math.round((height * norm.width) / norm.height / 2) * 2;
      return new Preview(
        proxyPath,
        dir,
        norm.duration,
        norm.fps,
        options.format ?? "png",
        ffmpeg,
        proxyWidth,
        proxyHeight,
        options.frameCacheMB ?? 512
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

  /**
   * Path to the all-keyframe proxy, for serving as a playable video.
   *
   * The proxy is a real mp4: every frame is a keyframe, so a `<video>` can both
   * play it straight through and seek it instantly. That is what makes scrubbing
   * and playback the same artifact instead of two renders.
   */
  get proxyFile(): string {
    return this.proxyPath;
  }

  /** Frame rate of the composition. */
  get frameRate(): number {
    return this.fps;
  }

  /**
   * Decode the proxy into RAM, once.
   *
   * Idempotent and shared: concurrent callers await the same decode instead of
   * racing several ffmpeg processes over the same file. Returns `undefined` when
   * the cache is disabled or the decode failed, so callers fall back to seeking.
   */
  private ensureCache(): Promise<FrameCache | undefined> {
    if (this.cache) return Promise.resolve(this.cache);
    if (this.cacheBytes === 0) return Promise.resolve(undefined);
    if (this.cachePromise) return this.cachePromise;

    this.cachePromise = FrameCache.build(
      this.ffmpeg,
      this.proxyPath,
      this.width,
      this.height,
      this.cacheBytes
    )
      .then((c) => {
        this.cache = c;
        return c;
      })
      .catch((err) => {
        // A cache failure must not break frame serving — the seek path still
        // works. Surface it once, then behave as if caching was never asked for.
        console.warn(`[kino] frame cache unavailable, falling back to seek: ${(err as Error).message}`);
        return undefined;
      });

    return this.cachePromise;
  }

  /** The cache, if it is built and covers this timestamp. */
  private cachedFrameAt(at: number): Buffer | undefined {
    const c = this.cache;
    if (!c) return undefined;
    const index = Math.round(at * this.fps);
    return c.has(index) ? c.get(index) : undefined;
  }

  /**
   * One frame as raw rgb24, for painting straight into a canvas.
   *
   * This is the fast path: no encode, no process. The browser draws it with
   * `putImageData`, which is a memcpy. Encoding to PNG/JPEG would need a spawn
   * per frame, and a spawn costs ~640 ms on Windows — more than the whole clip
   * is worth.
   *
   * Returns `undefined` when the timestamp is outside the cache; callers fall
   * back to {@link rawFrameBySeeking}.
   */
  rawFrame(at: number): { data: Buffer; width: number; height: number } | undefined {
    const clamped = Math.max(0, Math.min(this.duration - 1 / this.fps, at));
    const data = this.cachedFrameAt(clamped);
    if (!data) return undefined;
    return { data, width: this.width, height: this.height };
  }

  /**
   * One frame as raw rgba, by seeking the proxy — the cache-miss path.
   *
   * Slower than {@link rawFrame} because it spawns ffmpeg, but it is the same
   * data and the same shape, so a cache that does not cover the whole clip
   * degrades in speed instead of returning an error. A drag past the end of the
   * cache should feel slower, not break.
   */
  async rawFrameBySeeking(at: number): Promise<{ data: Buffer; width: number; height: number }> {
    const clamped = Math.max(0, Math.min(this.duration - 1 / this.fps, at));
    const data = await run(this.ffmpeg, [
      "-hide_banner", "-loglevel", "error",
      "-ss", String(clamped),
      "-i", this.proxyPath,
      "-frames:v", "1",
      "-f", "rawvideo", "-pix_fmt", "rgba", "-",
    ]);
    return { data, width: this.width, height: this.height };
  }

  /**
   * Raw frame from the cache if resident, otherwise by seeking the proxy.
   *
   * This is what a scrubbing client should call: it never fails for a valid
   * timestamp, and it is only slow where the cache does not reach.
   */
  async rawFrameAt(at: number): Promise<{ data: Buffer; width: number; height: number }> {
    await this.ensureCache();
    return this.rawFrame(at) ?? (await this.rawFrameBySeeking(at));
  }

  /** Proxy dimensions, needed by callers painting raw frames. */
  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /** Cache statistics, for reporting and tests. */
  get cacheStats(): { bytes: number; frames: number; total: number; stride: number } | undefined {
    if (!this.cache) return undefined;
    return {
      bytes: this.cache.bytes,
      frames: this.cache.cachedFrames,
      total: this.cache.totalFrames,
      stride: this.cache.stride,
    };
  }

  /** Build the frame cache now rather than on the first `frame()` call. */
  async warmCache(): Promise<void> {
    await this.ensureCache();
  }

  /**
   * Render one frame at `at` seconds.
   *
   * Prefer {@link rawFrame} on the hot path: this encodes to PNG/JPEG, which
   * costs a process spawn per frame.
   */
  async frame(at: number): Promise<PreviewFrame> {
    const t0 = Date.now();
    const clamped = Math.max(0, Math.min(this.duration - 1 / this.fps, at));
    const mime = this.format === "jpg" ? "image/jpeg" : "image/png";

    await this.ensureCache();

    const raw = this.cachedFrameAt(clamped);
    if (raw) {
      const data = await encodeRaw(this.ffmpeg, raw, this.width, this.height, this.format);
      return {
        at: clamped,
        data,
        url: `data:${mime};base64,${data.toString("base64")}`,
        ms: Date.now() - t0,
      };
    }

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
 * Encode raw rgb24 bytes to PNG or JPEG.
 *
 * This is the only per-frame cost left on the cached path, and it is a spawn —
 * so it is worth knowing why. Encoding to PNG/JPEG has no in-process path in
 * Node, and the browser needs a compressed format: a raw rgb24 frame is ~218 KB
 * at 360p and the browser would have to know its dimensions to display it.
 *
 * If this turns out to dominate, the next step is to serve raw rgb24 and let the
 * page paint it into a canvas via `putImageData`, which removes the encode
 * entirely. Measured before changing: see `Preview.frameCacheStats()`.
 */
function encodeRaw(
  bin: string,
  raw: Buffer,
  width: number,
  height: number,
  format: "png" | "jpg"
): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      bin,
      [
        "-hide_banner", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgba",
        "-s", `${width}x${height}`,
        "-i", "-",
        "-frames:v", "1",
        "-f", "image2pipe", "-vcodec", format === "jpg" ? "mjpeg" : "png",
        "-",
      ],
      { stdio: ["pipe", "pipe", "pipe"] }
    );

    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(Buffer.concat(chunks));
      else reject(new Error(`encode exited ${code}.${stderr.trim() ? `\n${stderr.trim()}` : ""}`));
    });

    child.stdin.end(raw);
  });
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


