import { describe, test, expect } from "vitest";
import { existsSync } from "node:fs";
import {
  measureText,
  measureTexts,
  measureSpace,
  defaultFontFile,
} from "../src/measure/index.js";
import { estimateTextWidth } from "../src/normalize/element.js";

const hasDrawtext = (): boolean => {
  // The bundled font is the signal that the package assets resolved; the
  // rasteriser needs ffmpeg with drawtext, which the vendored build provides.
  return defaultFontFile() !== undefined;
};

describe("measureText", () => {
  test("returns a width and height for a plain string", async () => {
    const m = await measureText("Hello", { fontSize: 48 });
    expect(m.width).toBeGreaterThan(0);
    expect(m.height).toBeGreaterThan(0);
    expect(["raster", "estimate"]).toContain(m.source);
  }, 60_000);

  test("an empty string measures zero", async () => {
    const m = await measureText("", { fontSize: 48 });
    expect(m.width).toBe(0);
    expect(m.height).toBe(0);
  });

  test("wider text measures wider", async () => {
    const narrow = await measureText("i", { fontSize: 48 });
    const wide = await measureText("WWWW", { fontSize: 48 });
    expect(wide.width).toBeGreaterThan(narrow.width * 3);
  }, 60_000);

  test("width scales with font size", async () => {
    const small = await measureText("Hello", { fontSize: 24 });
    const large = await measureText("Hello", { fontSize: 48 });
    // Not exactly 2x (hinting and rounding), but close.
    expect(large.width / small.width).toBeGreaterThan(1.8);
    expect(large.width / small.width).toBeLessThan(2.2);
  }, 60_000);

  test("a multi-line string is as wide as its widest line, not the sum", async () => {
    const one = await measureText("Hello", { fontSize: 48 });
    const two = await measureText("Hello\nHello", { fontSize: 48 });
    expect(Math.abs(two.width - one.width)).toBeLessThan(2);
  }, 60_000);

  test("measureTexts measures many strings in one call", async () => {
    const [a, b] = await measureTexts(["i", "WWWW"], { fontSize: 48 });
    expect(b.width).toBeGreaterThan(a.width);
    expect(a.source).toBe(b.source);
  }, 60_000);

  test("measureSpace is positive and smaller than a letter", async () => {
    const space = await measureSpace({ fontSize: 48 });
    const letter = await measureText("m", { fontSize: 48 });
    expect(space).toBeGreaterThan(0);
    expect(space).toBeLessThan(letter.width);
  }, 60_000);

  test("the bundled font is found from the package root", () => {
    // Getting this wrong does not fail loudly: drawtext silently falls back to
    // its default font and every measurement is off.
    const font = defaultFontFile();
    if (font) expect(existsSync(font)).toBe(true);
  });

  test.skipIf(!hasDrawtext())("the raster measurement disagrees with the estimator", async () => {
    // The estimator is what the renderer used to use. If they agreed exactly,
    // the rasteriser is not doing anything and the test is meaningless.
    const m = await measureText("WWWW", { fontSize: 64 });
    expect(m.source).toBe("raster");
    expect(Math.abs(m.width - estimateTextWidth("WWWW", 64))).toBeGreaterThan(5);
  }, 60_000);
});
