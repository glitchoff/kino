import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { composition, rect, text } from "../src/builder/index.js";
import { render } from "../src/pipeline/render.js";
import { getFFmpegBinaryPath } from "../src/encoder/probe.js";
import { resolveMotionBlur, shutterFromDegrees } from "../src/pipeline/elements/motion-blur.js";
import type { KinoComposition } from "../src/types/index.js";

const W = 640;
const H = 360;

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "kino-mblur-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Render and return the grayscale frames as one buffer. */
async function framesOf(comp: KinoComposition, name: string, count: number): Promise<Buffer> {
  const out = join(dir, `${name}.mp4`);
  await render(comp, { output: out });
  return execFileSync(
    getFFmpegBinaryPath(),
    ["-hide_banner", "-loglevel", "error", "-i", out, "-frames:v", String(count), "-f", "rawvideo", "-pix_fmt", "gray", "-"],
    { maxBuffer: 256 * 1024 * 1024 }
  );
}

/** Horizontal extent of anything visible on row `y` of frame `f`. */
function spanAt(raw: Buffer, f: number, y: number): number {
  const offset = f * W * H;
  let first = -1;
  let last = -1;
  for (let x = 0; x < W; x++) {
    if (raw[offset + y * W + x] > 20) {
      if (first < 0) first = x;
      last = x;
    }
  }
  return first < 0 ? 0 : last - first + 1;
}

/** A 40px square crossing the frame in `duration` seconds. */
function movingSquare(blur: unknown, duration = 0.75): KinoComposition {
  return composition({ width: W, height: H, fps: 24 })
    .scene({ duration: 1.5, background: "#000000" }, (s) => {
      s.add(
        rect({
          width: 40,
          height: 40,
          x: 0,
          y: 160,
          fill: "#ffffff",
          animation: { x: { from: 40, to: 560, duration, easing: "linear" } },
          ...(blur !== undefined ? { motionBlur: blur } : {}),
        })
      );
    })
    .build();
}

describe("resolveMotionBlur", () => {
  test("a bare number is the sample count with a 180° shutter", () => {
    expect(resolveMotionBlur(8)).toEqual({ samples: 8, shutter: 0.5 });
  });

  test("undefined and single-sample values disable it", () => {
    expect(resolveMotionBlur(undefined)).toBeUndefined();
    expect(resolveMotionBlur(1)).toBeUndefined();
    expect(resolveMotionBlur(0)).toBeUndefined();
  });

  test("samples are clamped to 16", () => {
    expect(resolveMotionBlur(64)?.samples).toBe(16);
  });

  test("shutter is clamped to 0..1", () => {
    expect(resolveMotionBlur({ samples: 4, shutter: 5 })?.shutter).toBe(1);
    expect(resolveMotionBlur({ samples: 4, shutter: -1 })?.shutter).toBe(0);
  });

  test("shutter angles convert to fractions of a frame", () => {
    expect(shutterFromDegrees(180)).toBe(0.5);
    expect(shutterFromDegrees(360)).toBe(1);
    expect(shutterFromDegrees(720)).toBe(1);
  });
});

describe.skipIf(process.platform !== "linux")("motion blur", () => {
  test("a moving element without blur stays crisp", async () => {
    const raw = await framesOf(movingSquare(undefined), "crisp", 12);
    expect(spanAt(raw, 10, 180)).toBe(40);
  }, 120_000);

  test("blur widens the element along its direction of travel", async () => {
    const raw = await framesOf(movingSquare(4), "blur4", 12);
    const width = spanAt(raw, 10, 180);
    // 40px square at 520px/s with a 180° shutter smears over tens of pixels.
    expect(width).toBeGreaterThan(80);
  }, 120_000);

  test("more samples smear further", async () => {
    const four = spanAt(await framesOf(movingSquare(4), "cmp4", 12), 10, 180);
    const sixteen = spanAt(await framesOf(movingSquare(16), "cmp16", 12), 10, 180);
    expect(sixteen).toBeGreaterThan(four);
  }, 180_000);

  test("blur follows the element rather than staying put", async () => {
    // A smear that did not move would be a static streak painted on the frame.
    const raw = await framesOf(movingSquare(8), "moving", 12);
    const early = spanAt(raw, 6, 180);
    const late = spanAt(raw, 11, 180);
    expect(early).toBeGreaterThan(80);
    expect(late).toBeGreaterThan(80);
    // Both are wide, and they are in different places.
    let firstEarly = -1;
    let firstLate = -1;
    for (let x = 0; x < W; x++) {
      if (firstEarly < 0 && raw[6 * W * H + 180 * W + x] > 20) firstEarly = x;
      if (firstLate < 0 && raw[11 * W * H + 180 * W + x] > 20) firstLate = x;
    }
    expect(firstLate).toBeGreaterThan(firstEarly);
  }, 120_000);

  test("a stationary element is not blurred", async () => {
    // No motion means nothing to smear: the shutter sees the same picture N
    // times, so the result must match an unblurred render.
    const build = (blur: unknown) =>
      composition({ width: W, height: H, fps: 24 })
        .scene({ duration: 1, background: "#000000" }, (s) => {
          s.add(rect({ width: 40, height: 40, x: 300, y: 160, fill: "#ffffff", ...(blur ? { motionBlur: blur } : {}) }));
        })
        .build();
    const plain = await framesOf(build(undefined), "still-plain", 8);
    const blurred = await framesOf(build(8), "still-blur", 8);
    expect(spanAt(blurred, 6, 180)).toBe(spanAt(plain, 6, 180));
  }, 120_000);

  test("text blurs too", async () => {
    const build = (blur: unknown) =>
      composition({ width: W, height: H, fps: 24 })
        .scene({ duration: 2, background: "#000000" }, (s) => {
          s.add(
            text("MOTION", {
              fontSize: 64,
              color: "#ffffff",
              x: 0,
              y: "center",
              animation: { x: { from: 0, to: 400, duration: 2, easing: "linear" } },
              ...(blur !== undefined ? { motionBlur: blur } : {}),
            })
          );
        })
        .build();
    const count = (raw: Buffer) => {
      let lit = 0;
      const offset = 15 * W * H;
      for (let i = 0; i < W * H; i++) if (raw[offset + i] > 20) lit++;
      return lit;
    };
    const plain = count(await framesOf(build(undefined), "txt-plain", 20));
    const blurred = count(await framesOf(build(8), "txt-blur", 20));
    expect(blurred).toBeGreaterThan(plain);
  }, 180_000);
});
