import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { composition, rect } from "../src/builder/index.js";
import { render } from "../src/pipeline/render.js";
import { getFFmpegBinaryPath } from "../src/encoder/probe.js";
import { validateComposition } from "../src/validate/index.js";
import { buildColorFilter, buildCurvesFilter, curvePointsExpression, isNeutralColor } from "../src/pipeline/elements/color.js";
import type { KinoComposition } from "../src/types/index.js";

const W = 64;
const H = 64;
const CENTRE = (32 * W + 32) * 3;

let dir: string;
let lutPath: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "kino-colour-"));
  // A 2×2×2 LUT that inverts RGB — the smallest thing that proves `lut3d` is
  // wired up and pointing at the right file.
  lutPath = join(dir, "invert.cube");
  const lines = ['TITLE "invert"', "LUT_3D_SIZE 2", "DOMAIN_MIN 0.0 0.0 0.0", "DOMAIN_MAX 1.0 1.0 1.0"];
  for (const b of [0, 1]) for (const g of [0, 1]) for (const r of [0, 1]) {
    lines.push(`${1 - r} ${1 - g} ${1 - b}`);
  }
  writeFileSync(lutPath, lines.join("\n") + "\n");
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Render one frame and read the centre pixel. */
async function centrePixel(comp: KinoComposition, name: string): Promise<[number, number, number]> {
  const out = join(dir, `${name}.mp4`);
  await render(comp, { output: out });
  const raw = execFileSync(
    getFFmpegBinaryPath(),
    ["-hide_banner", "-loglevel", "error", "-i", out, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 64 * 1024 * 1024 }
  );
  return [raw[CENTRE], raw[CENTRE + 1], raw[CENTRE + 2]];
}

/** A flat #804020 frame with an optional composition grade. */
function flat(grade?: Record<string, unknown>): KinoComposition {
  return composition({ width: W, height: H, fps: 24, ...(grade ? { grade } : {}) })
    .scene({ duration: 0.5, background: "#804020" }, () => {})
    .build();
}

const BASE: [number, number, number] = [126, 63, 30];

describe("curve expressions", () => {
  test("points become ffmpeg's in/out syntax", () => {
    expect(curvePointsExpression([[0, 0], [0.5, 0.7], [1, 1]])).toBe("0/0 0.5/0.7 1/1");
  });

  test("missing endpoints are filled in so the range passes through", () => {
    expect(curvePointsExpression([[0.5, 0.7]])).toBe("0/0 0.5/0.7 1/1");
  });

  test("out-of-order points are sorted", () => {
    expect(curvePointsExpression([[1, 1], [0.5, 0.7], [0, 0]])).toBe("0/0 0.5/0.7 1/1");
  });

  test("values outside 0..1 are clamped rather than reaching ffmpeg", () => {
    expect(curvePointsExpression([[-1, -1], [2, 2]])).toBe("0/0 1/1");
  });

  test("an empty curve produces no filter", () => {
    expect(curvePointsExpression([])).toBeUndefined();
    expect(buildCurvesFilter({})).toBeUndefined();
  });

  test("all four channels are emitted", () => {
    const f = buildCurvesFilter({
      master: [[0, 0], [1, 1]],
      red: [[0, 0], [0.5, 0.6], [1, 1]],
      blue: [[0, 0.1], [1, 1]],
    });
    expect(f).toContain("master='0/0 1/1'");
    expect(f).toContain("red='0/0 0.5/0.6 1/1'");
    expect(f).toContain("blue='0/0.1 1/1'");
    expect(f).not.toContain("green=");
  });
});

describe("filter order", () => {
  test("LUT comes before curves, levels, balance, eq and hue", () => {
    // The order is the contract: the same numbers in a different order look
    // different, so this test exists to stop a refactor silently reordering it.
    const f = buildColorFilter({
      lut: "a.cube",
      curves: { master: [[0, 0], [1, 1]] },
      lift: 0.1,
      balance: { shadows: [0.1, 0, 0] },
      contrast: 1.2,
      hue: 30,
    })!;
    const order = ["lut3d", "curves", "colorlevels", "colorbalance", "eq", "hue"].map((name) => f.indexOf(name));
    expect(order.every((idx) => idx >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("a LUT path is passed through the asset stager", () => {
    const f = buildColorFilter({ lut: "./looks/x.cube" }, () => "staged-1.cube");
    expect(f).toContain("staged-1.cube");
    expect(f).not.toContain("./looks/x.cube");
  });

  test("a neutral grade produces no filter", () => {
    expect(isNeutralColor({ brightness: 0, contrast: 1, saturation: 1, hue: 0, gamma: 1 })).toBe(true);
    expect(isNeutralColor({ lut: "a.cube" })).toBe(false);
    expect(isNeutralColor({ curves: { master: [[0, 0], [1, 1]] } })).toBe(false);
    expect(isNeutralColor({ balance: { shadows: [0, 0, 0] } })).toBe(false);
  });
});

describe.skipIf(process.platform !== "linux")("composition grade", () => {
  test("an ungraded composition renders its background as written", async () => {
    const px = await centrePixel(flat(), "plain");
    expect(px[0]).toBeGreaterThan(120);
    expect(px[1]).toBeLessThan(80);
  }, 120_000);

  test("a LUT changes the whole frame", async () => {
    const px = await centrePixel(flat({ lut: lutPath }), "lut");
    // The inverting LUT pushes the dark green and blue channels up towards
    // their maxima. Red is already near the middle, so inverting it barely
    // moves it — the other two are the reliable signal.
    expect(px[1]).toBeGreaterThan(BASE[1] + 100);
    expect(px[2]).toBeGreaterThan(BASE[2] + 150);
  }, 120_000);

  test("curves brighten", async () => {
    const px = await centrePixel(flat({ curves: { master: [[0, 0], [0.25, 0.5], [1, 1]] } }), "curves");
    expect(px[0]).toBeGreaterThan(BASE[0] + 40);
  }, 120_000);

  test("saturation 0 desaturates", async () => {
    const px = await centrePixel(flat({ saturation: 0 }), "sat0");
    const spread = Math.max(...px) - Math.min(...px);
    expect(spread).toBeLessThan(10);
  }, 120_000);

  test("balance only moves the band it names", async () => {
    // Shadows stay put for a midtone colour; that is what makes the three bands
    // useful. Probing a midtone here is deliberate: it proves `rs` does not leak
    // into the mids.
    const px = await centrePixel(flat({ balance: { shadows: [0.3, 0, 0] } }), "bal-sh");
    expect(Math.abs(px[0] - BASE[0])).toBeLessThan(6);
  }, 120_000);

  test("highlights balance shifts a bright frame", async () => {
    const bright = composition({ width: W, height: H, fps: 24, grade: { balance: { highlights: [0, 0, 0.3] } } })
      .scene({ duration: 0.5, background: "#e0e0e0" }, () => {})
      .build();
    const plain = composition({ width: W, height: H, fps: 24 })
      .scene({ duration: 0.5, background: "#e0e0e0" }, () => {})
      .build();
    const graded = await centrePixel(bright, "hi-graded");
    const raw = await centrePixel(plain, "hi-plain");
    expect(graded[2]).toBeGreaterThan(raw[2] + 10);
  }, 120_000);

  test("an element grade composes with the composition grade", async () => {
    // Element curves brighten the rect; the composition grade then desaturates
    // the finished frame. Both must be visible in the result.
    const comp = composition({ width: W, height: H, fps: 24, grade: { saturation: 0 } })
      .scene({ duration: 0.5, background: "#000000" }, (s) => {
        s.add(rect({ width: W, height: H, x: 0, y: 0, fill: "#804020", grade: { curves: { master: [[0, 0], [0.25, 0.5], [1, 1]] } } }));
      })
      .build();
    const px = await centrePixel(comp, "composed");
    expect(px[0]).toBeGreaterThan(BASE[0]);                 // curves brightened
    expect(Math.max(...px) - Math.min(...px)).toBeLessThan(10); // then desaturated
  }, 120_000);

  test("an element LUT applies to that element alone", async () => {
    const comp = composition({ width: W, height: H, fps: 24 })
      .scene({ duration: 0.5, background: "#202060" }, (s) => {
        s.add(rect({ width: 32, height: 32, x: 0, y: 0, fill: "#804020", grade: { lut: lutPath } }));
      })
      .build();
    const out = join(dir, "el-lut.mp4");
    await render(comp, { output: out });
    const raw = execFileSync(
      getFFmpegBinaryPath(),
      ["-hide_banner", "-loglevel", "error", "-i", out, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
      { maxBuffer: 64 * 1024 * 1024 }
    );
    const inside = (16 * W + 16) * 3;
    const outside = (56 * W + 56) * 3;
    expect(raw[inside + 1]).toBeGreaterThan(150);            // rect inverted: green high
    expect(raw[outside + 2]).toBeGreaterThan(raw[outside]);  // background untouched: blue
  }, 120_000);
});

describe("validation", () => {
  test("a LUT that is not a .cube is rejected", () => {
    expect(() => validateComposition(flat({ lut: "./looks/teal.png" }))).toThrow(/Expected a \.cube file/);
  });

  test("an unknown LUT interpolation is rejected", () => {
    expect(() => validateComposition(flat({ lut: "a.cube", lutInterp: "magic" }))).toThrow(/lutInterp/);
  });

  test("curve points outside 0..1 are rejected", () => {
    expect(() => validateComposition(flat({ curves: { master: [[0, 0], [2, 1]] } }))).toThrow(/within 0\.\.1/);
  });

  test("a balance triple must be three numbers", () => {
    expect(() => validateComposition(flat({ balance: { shadows: [0.1, 0.2] } as never }))).toThrow(/three numbers/);
  });

  test("a valid composition grade passes", () => {
    expect(() =>
      validateComposition(
        flat({ lut: "a.cube", curves: { master: [[0, 0], [0.5, 0.6], [1, 1]] }, balance: { shadows: [0.1, 0, 0] } })
      )
    ).not.toThrow();
  });
});
