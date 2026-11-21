import { spawn } from "node:child_process";

/**
 * Composites one frame by running ffmpeg for that frame, then exiting.
 *
 * ## Why stateless
 *
 * A long-lived process would be faster, and a stateful version was written and
 * abandoned: it had to track which frames had been buffered, which had already
 * been handed out, where the current run started, and when to restart. Four
 * interacting state machines, and every bug fixed exposed another — first a
 * listener leak (11+ `data` handlers per socket, then ECONNRESET), then a repeat
 * request waiting forever for a frame that had already been consumed, then every
 * request failing outright.
 *
 * This does the one thing that is known to work: spawn, ask ffmpeg for the frames
 * up to the target, keep the last one, exit. The same shape as the probe that
 * produced 120 correct frames on chapter.mts. No state to corrupt.
 *
 * ## The cost, measured
 *
 * `ffmpeg -version` alone costs ~640 ms on this machine, so every request pays
 * that. Decoding to the target adds the graph's own per-frame cost (~67 ms on a
 * 70-scene composition at 144p). A request near the start is therefore ~1 s and a
 * request at t=90s is longer, because the graph has no seekable input and must
 * evaluate every frame before it.
 *
 * That is not realtime playback. It is a reliable frame-on-demand endpoint, which
 * is what makes the preview usable at all: scrub, see the frame, every time.
 */
export class LiveRenderer {
  private closed = false;

  constructor(
    private readonly opts: {
      ffmpeg: string;
      /** Compiled video-only args, no output path. */
      graphArgs: string[];
      /** Directory the compiled args expect to run from. */
      cwd: string;
      width: number;
      height: number;
      fps: number;
      duration: number;
    }
  ) {}

  get stride(): number {
    return this.opts.width * this.opts.height * 4;
  }

  get totalFrames(): number {
    return Math.max(1, Math.round(this.opts.duration * this.opts.fps));
  }

  frameAt(seconds: number): number {
    const i = Math.round(seconds * this.opts.fps);
    return Math.max(0, Math.min(this.totalFrames - 1, i));
  }

  /**
   * The frame at `seconds`, as raw rgba.
   *
   * `-frames:v N` asks ffmpeg for every frame up to and including the target; the
   * last one written is the frame wanted. Reading them all is unavoidable because
   * the graph's inputs are stills and lavfi sources, so there is nothing to seek.
   */
  async frame(seconds: number): Promise<{ data: Buffer; ms: number; restarted: boolean }> {
    if (this.closed) throw new Error("[kino] live renderer is closed");
    const t0 = Date.now();
    const index = this.frameAt(seconds);
    const want = index + 1; // -frames:v counts frames, not an index
    const stride = this.stride;

    const data = await new Promise<Buffer>((resolve, reject) => {
      const child = spawn(
        this.opts.ffmpeg,
        [
          "-hide_banner", "-loglevel", "error",
          ...this.opts.graphArgs,
          "-frames:v", String(want),
          "-f", "rawvideo", "-pix_fmt", "rgba", "-",
        ],
        { cwd: this.opts.cwd, stdio: ["ignore", "pipe", "pipe"] }
      );

      // Keep only the most recent complete frame: earlier ones are discarded as
      // soon as the next arrives, so memory stays at one frame whatever the
      // target index is.
      let last: Buffer | undefined;
      let carry: Buffer = Buffer.alloc(0);
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        carry = carry.length === 0 ? chunk : Buffer.concat([carry, chunk]);
        while (carry.length >= stride) {
          last = Buffer.from(carry.subarray(0, stride));
          carry = carry.subarray(stride);
        }
      });

      child.stderr.on("data", (d: Buffer) => {
        if (stderr.length < 4000) stderr += d.toString();
      });

      child.on("error", reject);
      child.on("close", (code) => {
        if (last) return resolve(last);
        reject(
          new Error(
            `[kino] no frame at ${seconds.toFixed(3)}s (exit ${code})` +
              (stderr.trim() ? `\n${stderr.trim().slice(-600)}` : "")
          )
        );
      });
    });

    return { data, ms: Date.now() - t0, restarted: true };
  }

  close(): void {
    this.closed = true;
  }
}
