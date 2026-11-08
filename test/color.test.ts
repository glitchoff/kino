import { describe, test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { composition, rect } from "../src/builder/index.js";
import { exportComposition } from "../src/pipeline/export.js";
import { buildColorFilter, isNeutralColor } from "../src/pipeline/elements/color.js";
import { validateComposition } from "../src/validate/index.js";
import { getFFmpegBinaryPath } from "../src/encoder/probe.js";
import type { ColorAdjust } from "../src/types/elements.js";

/** Render a 100x100 flat rectangle with a grade and read its centre pixel. */
async function grade(fill: string, g: ColorAdjust | undefined): Promise<[number, number, number]> {
  const comp = composition({ width: 100, height: 100, fps: 12 })
    .scene({ duration: 1, background: "#000000" }, (s) => {
      s.add(rect({ width: 100, height: 100, x: 0, y: 0, fill, grade: g }));
    })
    .build();
  const dir = mkdtempSync(join(tmpdir(), "kino-grade-"));
  try {
    const { frames } = await exportComposition(comp, { frames: [0.3], frameDir: dir });
    const d = execFileSync(
      getFFmpegBinaryPath(),
      ["-hide_banner", "-loglevel", "error", "-i", frames![0].path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
      { maxBuffer: 64 * 1024 * 1024 }
    );
    const i = (50 * 100 + 50) * 3;
    return [d[i], d[i + 1], d[i + 2]];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("colour filter expressions", () => {
  test("a neutral grade produces no filter", () => {
    expect(isNeutralColor(undefined)).toBe(true);
    expect(isNeutralColor({})).toBe(true);
    expect(isNeutralColor({ brightness: 0, contrast: 1, saturation: 1 })).toBe(true);
    // `buildColorFilter` does not decide neutrality — the compiler checks
    // `isNeutralColor` first and skips the call. This is the contract.
    expect(buildColorFilter({ brightness: 0 })).toBe("eq=brightness=0");
  });

  test("a non-neutral grade produces one", () => {
    expect(isNeutralColor({ brightness: 0.2 })).toBe(false);
    expect(buildColorFilter({ brightness: 0.2 })).toContain("eq=");
  });

  test("lift uses the output floor, not the input black point", () => {
    // `rimin` clips shadows to black; it does not lift anything. Raising blacks
    // is `romin`.
    const f = buildColorFilter({ lift: 0.2 })!;
    expect(f).toContain("romin=0.2");
    expect(f).not.toContain("rimin");
  });

  test("lift accepts per-channel values", () => {
    expect(buildColorFilter({ lift: [0.1, 0.2, 0.3] })).toContain("romin=0.1:gomin=0.2:bomin=0.3");
  });

  test("gain uses the output ceiling, not the input white point", () => {
    // `rimax` clips to white rather than darkening, which is the opposite of
    // a gain.
    const f = buildColorFilter({ gain: 0.5 })!;
    expect(f).toContain("romax=0.5");
    expect(f).not.toContain("rimax");
  });

  test("hue only emits when it is non-zero", () => {
    expect(buildColorFilter({ hue: 0 })).toBeUndefined();
    expect(buildColorFilter({ hue: 90 })).toContain("hue=h=90");
  });
});

describe.skipIf(process.platform !== "linux")("colour grading — rendered", () => {
  test("brightness raises and lowers a flat grey", async () => {
    const base = await grade("#808080", undefined);
    expect(base[0]).toBeGreaterThan(120);
    expect(base[0]).toBeLessThan(136);

    const up = await grade("#808080", { brightness: 0.2 });
    const down = await grade("#808080", { brightness: -0.2 });
    expect(up[0]).toBeGreaterThan(base[0] + 30);
    expect(down[0]).toBeLessThan(base[0] - 30);
  }, 120_000);

  test("contrast pushes away from mid-grey", async () => {
    // 128 is the pivot, so a dark value moves further down.
    const dark = await grade("#404040", undefined);
    const darker = await grade("#404040", { contrast: 2 });
    expect(darker[0]).toBeLessThan(dark[0]);
  }, 120_000);

  test("saturation 0 makes colour neutral", async () => {
    const red = await grade("#ff0000", { saturation: 0 });
    expect(Math.abs(red[0] - red[1])).toBeLessThan(6);
    expect(Math.abs(red[1] - red[2])).toBeLessThan(6);
  }, 120_000);

  test("hue 120 rotates red to green", async () => {
    const g = await grade("#ff0000", { hue: 120 });
    expect(g[1]).toBeGreaterThan(g[0] + 60);
  }, 120_000);

  test("gamma brightens without clipping", async () => {
    const g = await grade("#808080", { gamma: 2 });
    expect(g[0]).toBeGreaterThan(150);
    expect(g[0]).toBeLessThan(255);
  }, 120_000);

  test("lift raises black", async () => {
    const lifted = await grade("#000000", { lift: 0.3 });
    expect(lifted[0]).toBeGreaterThan(40);
  }, 120_000);

  test("gain 0 crushes to black", async () => {
    const crushed = await grade("#ff0000", { gain: [0, 0, 0] });
    expect(crushed[0]).toBeLessThan(10);
  }, 120_000);
});

describe("colour validation", () => {
  const withGrade = (g: unknown) =>
    composition({ width: 100, height: 100 })
      .scene({ duration: 1 }, (s) => s.add(rect({ width: 10, height: 10, fill: "#fff", grade: g as never })))
      .build();

  test("accepts a valid grade", () => {
    expect(() => validateComposition(withGrade({ brightness: 0.1, contrast: 1.2 }))).not.toThrow();
  });

  test("rejects brightness outside -1..1", () => {
    expect(() => validateComposition(withGrade({ brightness: 2 }))).toThrow(/brightness/);
  });

  test("rejects a negative saturation", () => {
    expect(() => validateComposition(withGrade({ saturation: -1 }))).toThrow(/saturation/);
  });

  test("rejects a lift triple that is not three numbers", () => {
    expect(() => validateComposition(withGrade({ lift: [0.1, 0.2] }))).toThrow(/lift/);
  });

  test("rejects a non-object grade", () => {
    expect(() => validateComposition(withGrade("bright" as never))).toThrow(/colour adjustment/);
  });
});
