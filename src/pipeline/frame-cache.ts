import { spawn } from "node:child_process";

/**
 * A frame cache: decode the proxy once, then serve frames from memory.
 *
 * ## Why
 *
 * `Preview.frame()` used to spawn ffmpeg per call. On Windows a process spawn
 * costs ~640 ms — more than decoding 30 frames in one process. Measured:
 *
 *   spawn per frame          623 ms/frame
 *   spawn only (-version)    641 ms          <- the spawn *is* the cost
 *   30 frames, one process    17.7 ms/frame
 *   decode whole proxy once    0.0004 ms/frame
 *
 * So the only expensive thing was asking ffmpeg again. Decode the proxy to raw
 * RGB in a single pass, hold the frames, and a seek becomes an array index.
 *
 * ## The budget
 *
 * Raw frames are big: 360p is ~218 KB each, so 30 fps costs ~6.5 MB/s of clip.
 * A 266 s clip at 360p would be ~1.7 GB, which is not acceptable to hold by
 * default. The cache therefore has a budget. Below it, everything is resident
 * and seeks are free. Above it, the tail of the clip is not cached and those
 * timestamps fall back to seeking the proxy file (~17 ms, still 35x better than
 * a spawn).
 *
 * Frames are stored at a fixed stride so a lookup is `index * stride` into one
 * flat buffer, not an array of Buffers.
 */
export class FrameCache {
  /** Raw bytes of one frame (width * height * 3, rgb24). */
  readonly stride: number;
  /** How many frames at the start of the clip are resident. */
  readonly cachedFrames: number;
  /** Total frames in the proxy. */
  readonly totalFrames: number;
  /** Bytes actually held in RAM. */
  readonly bytes: number;

  private readonly buf: Buffer;

  private constructor(
    buf: Buffer,
    stride: number,
    cachedFrames: number,
    totalFrames: number
  ) {
    this.buf = buf;
    this.stride = stride;
    this.cachedFrames = cachedFrames;
    this.totalFrames = totalFrames;
    this.bytes = cachedFrames * stride;
  }

  /**
   * Decode `proxyPath` into memory, up to `budgetBytes`.
   *
   * The whole file is decoded regardless — ffmpeg writes frames sequentially
   * and there is no cheap way to stop early without knowing the frame count in
   * advance. Only the frames inside the budget are kept; the rest are read and
   * discarded, which costs one decode pass and then nothing.
   */
  static async build(
    ffmpeg: string,
    proxyPath: string,
    width: number,
    height: number,
    budgetBytes: number
  ): Promise<FrameCache> {
    // rgba, not rgb24: the consumer is `putImageData`, which takes rgba. Decoding
    // to rgb24 and expanding per request would cost a pass over every frame on
    // the hot path — cheaper to store the extra byte once.
    const stride = width * height * 4;
    const maxFrames = Math.max(1, Math.floor(budgetBytes / stride));

    // Pre-allocate to the budget. A clip shorter than the budget leaves the
    // buffer partly unused, which is why `cachedFrames` is tracked separately
    // rather than derived from the buffer length.
    let buf: Buffer<ArrayBuffer> = Buffer.allocUnsafe(maxFrames * stride);
    let count = 0;
    let total = 0;

    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        ffmpeg,
        [
          "-hide_banner", "-loglevel", "error",
          "-i", proxyPath,
          "-f", "rawvideo", "-pix_fmt", "rgba", "-",
        ],
        { stdio: ["ignore", "pipe", "pipe"] }
      );

      let pending: Buffer = Buffer.alloc(0);
      let stderr = "";
      child.stderr.on("data", (d) => {
        if (stderr.length < 4000) stderr += d;
      });

      child.stdout.on("data", (chunk: Buffer) => {
        pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);

        while (pending.length >= stride) {
          if (count < maxFrames) {
            pending.copy(buf, count * stride, 0, stride);
            count++;
          }
          total++;
          pending = pending.subarray(stride);
        }
      });

      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0 && total === 0) {
          reject(new Error(`[kino] frame cache decode failed: ${stderr.trim()}`));
          return;
        }
        resolve();
      });
    });

    // Shrink to what was actually filled so the reported byte count is honest.
    if (count < maxFrames) buf = buf.subarray(0, count * stride);

    return new FrameCache(buf, stride, count, total);
  }

  /** True when `index` is resident and can be served without touching disk. */
  has(index: number): boolean {
    return index >= 0 && index < this.cachedFrames;
  }

  /** The raw rgb24 bytes for a resident frame. Copies, so callers can't mutate the cache. */
  get(index: number): Buffer {
    if (!this.has(index)) throw new RangeError(`[kino] frame ${index} not cached`);
    return Buffer.from(this.buf.subarray(index * this.stride, (index + 1) * this.stride));
  }
}
