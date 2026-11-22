import { rmSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { KinoComposition } from "../types/index.js";
import { compile } from "./compile.js";
import { extractKino, readKinoManifest } from "../artifact/kino.js";
import { getFFmpegBinaryPath } from "../encoder/probe.js";
import { renderTakumiElements } from "./elements/takumi-elements.js";
import { FrameCache } from "./frame-cache.js";
import { LiveRenderer } from "./live-renderer.js";
import { videoOnlyArgs } from "./video-only.js";
import { scratchDir } from "./scratch.js";
import { resolveTtsTracks, compositionHasTts } from "../tts/resolve.js";

/**
 * A preview session: compile once, then pull frames on demand.
 *
 * A one-shot still costs ~65ms, almost all of it process spawn and decode. A
 * session amortises the compile and, more importantly, renders the composition
 * to a small proxy file first â€” seeking that is ~23ms per frame, and scrubbing
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
  /**
   * Where scratch (the proxy, extracted assets) may live. Defaults to the
   * process cwd's `.kino/`; pass the render's output path to put scratch beside
   * it. See `scratchRoot`.
   */
  scratchDir?: string;
  /**
   * Composite frames live instead of building a proxy file. **Experimental.**
   *
   * Default `false`, and it should stay that way. The graph half works -- the
   * audio chains are pruned correctly and a standalone ffmpeg run produced 120
   * correct frames at ~67 ms/frame on a 70-scene chapter at 144p -- but the HTTP
   * path never served a frame reliably. Four bugs in sequence, each fix exposing
   * the next; see `.memory/findings-live-render.md`.
   *
   * `LiveRenderer` is now stateless (spawn per request, keep the last frame,
   * exit), which is correct but pays the ~640 ms spawn per request and must
   * evaluate every frame before the target, because the graph's inputs are
   * stills and lavfi sources with nothing to seek.
   *
   * The proxy path is what works:
   *
   *   proxy      ~0.5 ms/frame after a one-time build
   *   live       ~640 ms spawn + ~67 ms/frame, no build
   *
   * Its cost is time-to-first-frame, not per-frame -- which is why the segment
   * cache is the thing to build next, not another live renderer.
   */
  live?: boolean;
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
  /** Set when `live: true`; composites frames instead of reading a proxy. */
  private live?: LiveRenderer;

  private constructor(
    private readonly proxyPath: string,
    private readonly dir: string,
    private readonly duration: number,
    private readonly fps: number,
    private readonly format: "png" | "jpg",
    private readonly ffmpeg: string,
    width: number,
    height: number,
    frameCacheMB: number,
    live?: LiveRenderer
  ) {
    this.width = width;
    this.height = height;
    this.cacheBytes = Math.max(0, frameCacheMB) * 1024 * 1024;
    this.live = live;
  }

  /** True when frames are composited on demand rather than read from a proxy. */
  get isLive(): boolean {
    return this.live !== undefined;
  }

  /** Build a preview for a composition. Compiles and renders the proxy once. */
  static async open(
    compositionOrSpec: KinoComposition,
    options: PreviewOptions = {}
  ): Promise<Preview> {
    const ffmpeg = getFFmpegBinaryPath(options.ffmpegPath);
    // Scratch beside the output, not `os.tmpdir()`. On this machine the system
    // temp dir sits on C:, which had 0.4 GB free while the project disk had far
    // more — and a preview server that is killed never calls `close()`, so every
    // run left its whole proxy behind. 31 such folders (1 GB) were found in
    // `%TEMP%` on 2026-11-21.
    const dir = scratchDir("kino-preview-", { outputPath: options.scratchDir });

    // `close()` is the normal path, but a killed process (Ctrl-C, a crash, the
    // OS reclaiming memory) never reaches it. Register a one-shot cleanup so the
    // proxy cannot outlive the process.
    const cleanup = (): void => {
      rmSync(dir, { recursive: true, force: true });
    };
    process.once("exit", cleanup);
    try {
      // TTS is synthesised up front, exactly as `render()` does: `compile()` is
      // synchronous and `prestageRemoteAssets` expects every `src` to be a path.
      // A raw TTS spec object reaches it otherwise and `src.startsWith` throws â€”
      // which is what made every `voice()` composition fail to preview.
      let composition = compositionOrSpec;
      if (compositionHasTts(composition)) {
        composition = await resolveTtsTracks(composition);
      }

      const takumi = await renderTakumiElements(composition);
      const height = options.height ?? 360;
      // `preview` bakes the downscale into the filtergraph and switches the
      // encoder to ultrafast/CRF 30 — exactly the proxy this needs. Adding a
      // `-vf` on top is not possible: the compiled args already use
      // `-filter_complex`, and ffmpeg refuses simple and complex filtering on
      // the same stream.
      let kino;
      try {
        kino = compile(composition, {
          output: join(dir, "full.mp4"),
          takumiRenders: takumi.paths,
          preview: height,
        });
      } finally {
        // compile() has copied the PNGs into the .kino by now.
        takumi.cleanup();
      }

      // Read the manifest straight from the archive; extracting is only needed
      // for the assets, and ffmpeg is pointed at the extracted directory.
      const manifest = readKinoManifest(kino.kinoFilePath);
      const extractDir = join(dir, "extract");
      extractKino(kino.kinoFilePath, extractDir);

      const { normalizeComposition } = await import("../normalize/composition.js");
      const norm = normalizeComposition(composition);
      const proxyHeight = height;
      const proxyWidth = Math.round((height * norm.width) / norm.height / 2) * 2;

      // Live mode: no proxy file at all. The compiled graph is rewritten to a
      // video-only variant and a long-lived ffmpeg streams frames from it.
      if (options.live) {
        const { args, videoPad, chains } = videoOnlyArgs(manifest.ffmpegArgs, extractDir);
        const live = new LiveRenderer({
          ffmpeg,
          graphArgs: args,
          cwd: extractDir,
          width: proxyWidth,
          height: proxyHeight,
          fps: norm.fps,
          duration: norm.duration,
        });
        console.log(
          `[kino] live preview: ${chains.kept}/${chains.total} filter chains kept, ` +
            `video pad ${videoPad}, no proxy build`
        );
        return new Preview(
          "",
          dir,
          norm.duration,
          norm.fps,
          options.format ?? "png",
          ffmpeg,
          proxyWidth,
          proxyHeight,
          options.frameCacheMB ?? 512,
          live
        );
      }

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
    // Live mode has no proxy file, so there is nothing to decode into a cache.
    // Running this path anyway reported a 536 MB cache of frames read from a
    // path that does not exist, and those black frames could shadow the live
    // renderer's output.
    if (this.live) return Promise.resolve(undefined);
    if (this.cache) return Promise.resolve(this.cache);
    if (this.cacheBytes === 0) return Promise.resolve(undefined);
    if (this.cachePromise) return this.cachePromise;

    this.cachePromise = FrameCache.open({
      ffmpeg: this.ffmpeg,
      proxyPath: this.proxyPath,
      width: this.width,
      height: this.height,
      fps: this.fps,
      duration: this.duration,
      budgetBytes: this.cacheBytes,
    })
      .then((c) => {
        this.cache = c;
        return c;
      })
      .catch((err) => {
        // A cache failure must not break frame serving â€” the seek path still
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
    const index = c.frameAt(at);
    return c.has(index) ? c.get(index) : undefined;
  }

  /**
   * One frame as raw rgb24, for painting straight into a canvas.
   *
   * This is the fast path: no encode, no process. The browser draws it with
   * `putImageData`, which is a memcpy. Encoding to PNG/JPEG would need a spawn
   * per frame, and a spawn costs ~640 ms on Windows â€” more than the whole clip
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
   * One frame as raw rgba, by seeking the proxy â€” the cache-miss path.
   *
   * In live mode there is no proxy, so this composites instead. Slower than
   * {@link rawFrame}, but the same data and the same shape, so a caller never has
   * to know which mode is running.
   */
  async rawFrameBySeeking(at: number): Promise<{ data: Buffer; width: number; height: number }> {
    const clamped = Math.max(0, Math.min(this.duration - 1 / this.fps, at));

    if (this.live) {
      const frame = await this.live.frame(clamped);
      return { data: frame.data, width: this.width, height: this.height };
    }

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
    // Live mode has no proxy and no cache â€” every frame is composited.
    if (this.live) return this.rawFrameBySeeking(at);

    await this.ensureCache();
    // Slide the window to cover this timestamp before asking for it. A fill
    // costs one decode; a miss after that would mean seeking, so this is what
    // keeps a drag inside a region fast.
    if (this.cache) {
      const clamped = Math.max(0, Math.min(this.duration - 1 / this.fps, at));
      await this.cache.ensure(this.cache.frameAt(clamped));
    }
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
      frames: this.cache.capacity,
      total: this.cache.totalFrames,
      stride: this.cache.stride,
    };
  }

  /**
   * Build the frame cache now rather than on the first `frame()` call.
   *
   * Opening fills a window around t=0, which is one ffmpeg run over the proxy.
   * That is the same decode the first seek would trigger, so doing it here means
   * the first scrub is already fast.
   */
  async warmCache(): Promise<void> {
    // Nothing to warm in live mode: frames are composited, not decoded.
    if (this.live) return;
    await this.ensureCache();
  }

  /** Cache statistics, for reporting and tests. Built on demand. */
  async getCacheStats(): Promise<
    { bytes: number; frames: number; total: number; stride: number } | undefined
  > {
    // No proxy, no cache — reporting one would be a lie.
    if (this.live) return undefined;
    await this.ensureCache();
    if (!this.cache) return undefined;
    return {
      bytes: this.cache.bytes,
      frames: this.cache.capacity,
      total: this.cache.totalFrames,
      stride: this.cache.stride,
    };
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
    this.live?.close();
    // The `exit` hook registered by `open()` is idempotent and cheap, so it is
    // left in place rather than tracked; `rmSync` with `force` tolerates a
    // directory that is already gone.
    rmSync(this.dir, { recursive: true, force: true });
  }
}

/**
 * Encode raw rgb24 bytes to PNG or JPEG.
 *
 * This is the only per-frame cost left on the cached path, and it is a spawn â€”
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


