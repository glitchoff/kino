import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { composition, rect, text } from "../src/builder/index.js";
import { render } from "../src/pipeline/render.js";
import { getFFmpegBinaryPath } from "../src/encoder/probe.js";
import { validateComposition } from "../src/validate/index.js";
import type { KinoComposition } from "../src/types/index.js";

const W = 320;
const H = 180;

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "kino-blend-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Render one frame and return a pixel reader. */
async function frameOf(comp: KinoComposition, name: string) {
  const out = join(dir, `${name}.mp4`);
  await render(comp, { output: out });
  const raw = execFileSync(
    getFFmpegBinaryPath(),
    ["-hide_banner", "-loglevel", "error", "-i", out, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 64 * 1024 * 1024 }
  );
  return (x: number, y: number): [number, number, number] => {
    const i = (y * W + x) * 3;
    return [raw[i], raw[i + 1], raw[i + 2]];
  };
}

/** A full-frame rect over a known background. */
function fullFrame(opts: Record<string, unknown>): KinoComposition {
  return composition({ width: W, height: H, fps: 24 })
    .scene({ duration: 1, background: "#202060" }, (s) => {
      s.add(rect({ width: W, height: H, x: 0, y: 0, fill: "#804020", ...opts }));
    })
    .build();
}

const BASE: [number, number, number] = [32, 32, 96]; // #202060
const ELEM: [number, number, number] = [128, 64, 32]; // #804020

/** Allow a couple of levels for yuv420p rounding. */
function near(actual: number[], expected: number[], tolerance = 4) {
  for (let i = 0; i < expected.length; i++) {
    expect(Math.abs(actual[i] - expected[i])).toBeLessThanOrEqual(tolerance);
  }
}

describe.skipIf(process.platform !== "linux")("blend modes", () => {
  test("no blend leaves the element as a plain overlay", async () => {
    const px = await frameOf(fullFrame({}), "plain");
    near(px(160, 90), ELEM);
  }, 120_000);

  test("screen lightens, matching the blend formula", async () => {
    const px = await frameOf(fullFrame({ blend: "screen" }), "screen");
    // screen(a,b) = a + b - a*b/255
    const expected = [0, 1, 2].map((i) => BASE[i] + ELEM[i] - Math.floor((BASE[i] * ELEM[i]) / 255));
    near(px(160, 90), expected, 6);
    // Screen must be brighter than either input.
    expect(px(160, 90)[0]).toBeGreaterThan(ELEM[0]);
  }, 120_000);

  test("multiply darkens, matching the blend formula", async () => {
    const px = await frameOf(fullFrame({ blend: "multiply" }), "multiply");
    const expected = [0, 1, 2].map((i) => Math.floor((BASE[i] * ELEM[i]) / 255));
    // Regression: without an explicit rgb24 before the encoder's yuv420p
    // conversion, ffmpeg misreads blend's range and this came out 0,67,0.
    near(px(160, 90), expected, 6);
  }, 120_000);

  test("blending a positioned element leaves the rest of the frame untouched", async () => {
    // The whole reason for the transparent-canvas stage: `blend` needs
    // full-frame inputs, so a small element is laid onto one. Outside the
    // element the base must survive.
    const comp = composition({ width: W, height: H, fps: 24 })
      .scene({ duration: 1, background: "#202060" }, (s) => {
        s.add(rect({ width: 80, height: 80, x: 40, y: 40, fill: "#ffffff", blend: "screen" }));
      })
      .build();
    const px = await frameOf(comp, "positioned");
    near(px(80, 80), [255, 255, 255], 6); // inside: white screened over
    near(px(250, 150), BASE, 4);          // outside: untouched
  }, 120_000);

  test("an unknown blend mode is rejected before rendering", () => {
    const comp = fullFrame({ blend: "glow" });
    expect(() => validateComposition(comp)).toThrow(/Unknown blend mode/);
  });
});

describe.skipIf(process.platform !== "linux")("masks", () => {
  test("an ellipse mask hides the element outside it", async () => {
    const px = await frameOf(fullFrame({ mask: { shape: "ellipse" } }), "mask-ellipse");
    near(px(160, 90), ELEM); // centre: element visible
    near(px(2, 2), BASE, 6); // corner: outside the ellipse, base shows
  }, 120_000);

  test("invert swaps inside and outside", async () => {
    const px = await frameOf(fullFrame({ mask: { shape: "ellipse", invert: true } }), "mask-invert");
    near(px(160, 90), BASE, 6);
    near(px(2, 2), ELEM, 6);
  }, 120_000);

  test("feather softens the edge instead of cutting it", async () => {
    // A hard ellipse edge jumps straight from base to element; a feathered one
    // passes through intermediate values on the way.
    const px = await frameOf(fullFrame({ mask: { shape: "ellipse", feather: 20 } }), "mask-feather");
    const column: number[] = [];
    for (let y = 0; y <= 90; y += 2) column.push(px(160, y)[0]);
    const intermediate = column.filter((v) => v > 10 && v < 245).length;
    expect(intermediate).toBeGreaterThan(2);
  }, 120_000);

  test("a linear mask fades along the chosen axis", async () => {
    const px = await frameOf(fullFrame({ mask: { shape: "linear", direction: "down" } }), "mask-linear");
    const top = px(160, 4)[0];
    const bottom = px(160, H - 4)[0];
    expect(bottom).toBeGreaterThan(top);
  }, 120_000);

  test("a luma matte from a file drives the alpha", async () => {
    const matte = join(dir, "half.png");
    execFileSync(getFFmpegBinaryPath(), [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", `color=c=black:s=${W}x${H}:d=1`,
      "-f", "lavfi", "-i", `color=c=white:s=${W / 2}x${H}:d=1`,
      "-filter_complex", "[0:v][1:v]overlay=0:0", "-frames:v", "1", matte,
    ]);
    const px = await frameOf(fullFrame({ mask: { src: matte } }), "mask-src");
    // Where the matte is white the element shows through; where it is black the
    // background does. The element here is the #804020 rect, not white.
    near(px(40, 90), ELEM, 6);
    near(px(280, 90), BASE, 6);
  }, 120_000);

  test("a mask works on text", async () => {
    // The case the ticket flagged as uncertain: text is painted by drawtext
    // onto its input, so masking it needs the same blank-canvas treatment.
    const comp = composition({ width: W, height: H, fps: 24 })
      .scene({ duration: 1, background: "#000000" }, (s) => {
        s.add(text("MASKED", { fontSize: 44, color: "#ffffff", x: "center", y: "center", mask: { shape: "ellipse", feather: 10 } }));
      })
      .build();
    const px = await frameOf(comp, "text-mask");
    let bright = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px(x, y)[0] > 128) bright++;
    expect(bright).toBeGreaterThan(500);
  }, 120_000);

  test("a mask with neither shape nor src is rejected", () => {
    const comp = fullFrame({ mask: {} });
    expect(() => validateComposition(comp)).toThrow(/needs either `shape` or `src`/);
  });
});
