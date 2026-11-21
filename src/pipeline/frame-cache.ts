import { spawn } from "node:child_process";

/**
 * A sliding-window frame cache: decoded frames held in a ring, around the
 * playhead.
 *
 * ## Why a window and not a prefix
 *
 * Decoding the proxy into memory made a seek an array lookup (0.0004 ms) instead
 * of a process spawn (623 ms). But frames are big — 921 KB each at 640x360 — so
 * a 266 s clip needs ~7 GB and cannot be held whole. The first version kept
 * frames from t=0 until the budget ran out, which meant scrubbing was instant
 * near the start and slow near the end. That is the wrong shape: you scrub
 * wherever you are working.
 *
 * A window keeps a fixed number of frames *around the current position*. Moving
 * the playhead shifts the window; frames that fall out are overwritten. Memory
 * is constant regardless of clip length, and every region becomes fast once it
 * has been visited.
 *
 * ## The cost
 *
 * The first visit to a region needs a decode. That is one ffmpeg run over the
 * proxy, seeking to the window start, filling the ring. Until it completes, a
 * frame outside the window falls back to seeking the proxy — slower (~17 ms) but
 * correct, so a drag never shows a hole or an error.
 *
 * ## Layout
 *
 * A single flat buffer of `capacity * stride` bytes. Slot for frame `i` is
 * `i % capacity`, and `present` records whether that slot currently holds frame
 * `i` or a stale one. No per-frame allocation, no Map churn.
 */
export class FrameCache {
  /** Bytes of one frame (width * height * 4, rgba). */
  readonly stride: number;
  /** Total frames in the proxy. */
  readonly totalFrames: number;
  /** How many frames the window can hold. */
  readonly capacity: number;
  /** Bytes held in RAM. */
  readonly bytes: number;

  private readonly buf: Buffer<ArrayBuffer>;
  /** `present[slot]` is the frame index in that slot, or -1 when empty. */
  private readonly present: Int32Array;
  /** Inclusive window of frame indices currently resident, or -1 when none. */
  private winStart = -1;
  private winEnd = -1;

  private readonly ffmpeg: string;
  private readonly proxyPath: string;
  private readonly fps: number;
  private fillPromise?: Promise<void>;

  private constructor(
    ffmpeg: string,
    proxyPath: string,
    stride: number,
    totalFrames: number,
    capacity: number,
    fps: number
  ) {
    this.ffmpeg = ffmpeg;
    this.proxyPath = proxyPath;
    this.stride = stride;
    this.totalFrames = totalFrames;
    this.capacity = capacity;
    this.fps = fps;
    this.buf = Buffer.allocUnsafe(capacity * stride);
    this.present = new Int32Array(capacity).fill(-1);
    this.bytes = capacity * stride;
  }

  /**
   * Build a cache and fill the window around `atFrame`.
   *
   * `totalFrames` is known from the proxy's duration and frame rate, so the
   * window size is `min(totalFrames, budget / stride)` — a short clip is held
   * entirely and never slides.
   */
  static async open(opts: {
    ffmpeg: string;
    proxyPath: string;
    width: number;
    height: number;
    fps: number;
    duration: number;
    budgetBytes: number;
    /** Frame to centre the first window on. Default 0. */
    atFrame?: number;
  }): Promise<FrameCache> {
    const stride = opts.width * opts.height * 4;
    const totalFrames = Math.max(1, Math.round(opts.duration * opts.fps));
    const capacity = Math.max(1, Math.min(totalFrames, Math.floor(opts.budgetBytes / stride)));

    const cache = new FrameCache(
      opts.ffmpeg,
      opts.proxyPath,
      stride,
      totalFrames,
      capacity,
      opts.fps
    );
    await cache.fill(opts.atFrame ?? 0);
    return cache;
  }

  /** True when frame `index` is resident and can be served without decoding. */
  has(index: number): boolean {
    if (index < 0 || index >= this.totalFrames) return false;
    return this.present[index % this.capacity] === index;
  }

  /** Raw rgba bytes for a resident frame. Copies, so callers cannot mutate it. */
  get(index: number): Buffer {
    if (!this.has(index)) throw new RangeError(`[kino] frame ${index} not in window`);
    const slot = index % this.capacity;
    return Buffer.from(this.buf.subarray(slot * this.stride, (slot + 1) * this.stride));
  }

  /**
   * Frame index for a timestamp, clamped into the clip.
   *
   * One helper so the cache and the caller agree on rounding — an off-by-one
   * here shows as a one-frame flicker while scrubbing.
   */
  frameAt(seconds: number): number {
    const i = Math.round(seconds * this.fps);
    return Math.max(0, Math.min(this.totalFrames - 1, i));
  }

  /**
   * Ensure the window covers `atFrame`, decoding if it does not.
   *
   * Idempotent and serialised: concurrent callers while a fill is running share
   * that fill rather than spawning several ffmpeg processes over one proxy.
   */
  async ensure(atFrame: number): Promise<void> {
    const target = Math.max(0, Math.min(this.totalFrames - 1, atFrame));
    if (this.has(target)) return;
    if (this.fillPromise) {
      await this.fillPromise;
      if (this.has(target)) return;
    }
    await this.fill(target);
  }

  /**
   * Decode the proxy from the window start and fill the ring.
   *
   * The window is centred on `centre` but never runs past the clip's ends, so
   * the last few seconds are held rather than half-empty.
   */
  private fill(centre: number): Promise<void> {
    this.fillPromise = this.doFill(centre).finally(() => {
      this.fillPromise = undefined;
    });
    return this.fillPromise;
  }

  private doFill(centre: number): Promise<void> {
    const half = Math.floor(this.capacity / 2);
    let start = Math.max(0, centre - half);
    if (start + this.capacity > this.totalFrames) {
      start = Math.max(0, this.totalFrames - this.capacity);
    }
    const count = Math.min(this.capacity, this.totalFrames - start);
    const end = start + count - 1;

    // Already covered: nothing to decode.
    if (this.winStart === start && this.winEnd === end) return Promise.resolve();

    const seek = start / this.fps;

    return new Promise<void>((resolve) => {
      const child = spawn(
        this.ffmpeg,
        [
          "-hide_banner", "-loglevel", "error",
          // Seek before -i: input seeking is a demuxer jump, and every frame in
          // the proxy is a keyframe, so it lands exactly.
          "-ss", String(seek),
          "-i", this.proxyPath,
          "-frames:v", String(count),
          "-f", "rawvideo", "-pix_fmt", "rgba", "-",
        ],
        { stdio: ["ignore", "pipe", "pipe"] }
      );

      // Bytes are copied straight into the ring as they arrive.
      //
      // The obvious version — accumulate into a `pending` buffer with
      // `Buffer.concat` and slice frames off it — is quadratic: every chunk
      // reallocates and copies everything buffered so far. For a 256 MB window
      // arriving in ~64 KB chunks that was 4,000 copies of a growing buffer,
      // and it measured 5,763 ms where raw ffmpeg needed 1,532 ms. Keeping a
      // write cursor into the ring removes the copying entirely.
      let frameIndex = start;
      let frameOffset = 0; // bytes already written into the current frame

      const writeChunk = (chunk: Buffer) => {
        let read = 0;
        while (read < chunk.length && frameIndex < start + count) {
          const slot = frameIndex % this.capacity;
          const dest = slot * this.stride + frameOffset;
          const room = this.stride - frameOffset;
          const take = Math.min(room, chunk.length - read);

          chunk.copy(this.buf, dest, read, read + take);
          read += take;
          frameOffset += take;

          if (frameOffset === this.stride) {
            this.present[slot] = frameIndex;
            frameIndex++;
            frameOffset = 0;
          }
        }
      };

      child.stdout.on("data", writeChunk);

      const finish = () => {
        const written = frameIndex - start;
        if (written > 0) {
          this.winStart = start;
          this.winEnd = start + written - 1;
        }
        resolve();
      };

      child.on("error", finish);
      child.on("close", finish);
    });
  }
}
