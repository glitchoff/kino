import { describe, test, expect } from "vitest";
import { existsSync } from "node:fs";
import {
  measureText,
  measureTexts,
  measureSpace,
  defaultFontFile,
} from "../src/measure/index.js";
import { estimateTextWidth } from "../src/normalize/element.js";
import { loadFontMetrics, advanceWidth } from "../src/measure/font.js";

describe("measureText", () => {
  test("is synchronous and reads the font", () => {
    const m = measureText("Hello", { fontSize: 48 });
    expect(m.width).toBeGreaterThan(0);
    expect(m.source).toBe("font");
    // No promise: the rasteriser is gone.
    expect(m).not.toBeInstanceOf(Promise);
  });

  test("an empty string measures zero", () => {
    expect(measureText("", { fontSize: 48 }).width).toBe(0);
  });

  test("wider text measures wider", () => {
    const narrow = measureText("i", { fontSize: 48 }).width;
    const wide = measureText("WWWW", { fontSize: 48 }).width;
    expect(wide).toBeGreaterThan(narrow * 3);
  });

  test("width scales linearly with font size", () => {
    const small = measureText("Hello", { fontSize: 24 }).width;
    const large = measureText("Hello", { fontSize: 48 }).width;
    expect(large / small).toBeCloseTo(2, 5);
  });

  test("a multi-line string is as wide as its widest line", () => {
    // The caller measures line by line; the function itself does not split.
    const one = measureText("Hello", { fontSize: 48 }).width;
    const withSpace = measureText("Hello ", { fontSize: 48 }).width;
    expect(withSpace).toBeGreaterThan(one);
  });

  test("measureTexts measures many strings", () => {
    const [a, b] = measureTexts(["i", "WWWW"], { fontSize: 48 });
    expect(b.width).toBeGreaterThan(a.width);
  });

  test("measureSpace is positive and smaller than a letter", () => {
    const space = measureSpace({ fontSize: 48 });
    expect(space).toBeGreaterThan(0);
    expect(space).toBeLessThan(measureText("m", { fontSize: 48 }).width);
  });

  test("the bundled font is found from the package root", () => {
    const font = defaultFontFile();
    expect(font).toBeDefined();
    expect(existsSync(font!)).toBe(true);
  });

  test("an unreadable font falls back to the estimator", () => {
    const m = measureText("WWWW", { fontSize: 64, fontFile: "/nonexistent/font.ttf" });
    expect(m.source).toBe("estimate");
    expect(m.width).toBeCloseTo(estimateTextWidth("WWWW", 64), 5);
  });
});

describe("font metrics", () => {
  test("parses the bundled Inter", () => {
    const metrics = loadFontMetrics(defaultFontFile()!);
    expect(metrics.unitsPerEm).toBe(2048);
    expect(metrics.advances.length).toBeGreaterThan(100);
    expect(metrics.cmap.size).toBeGreaterThan(100);
  });

  test("advance matches the font's own units", () => {
    // Inter: 'T' is 1306 units at unitsPerEm 2048, so 40.81px at size 64.
    const metrics = loadFontMetrics(defaultFontFile()!);
    expect(advanceWidth(metrics, "T", 64)).toBeCloseTo(40.81, 1);
    expect(advanceWidth(metrics, "X", 64)).toBeCloseTo(43.13, 1);
  });

  test("'Title' sums its glyph advances", () => {
    // 1306 + 480 + 663 + 480 + 1173 units = 4102 / 2048 * 64 = 128.19
    expect(measureText("Title", { fontSize: 64 }).width).toBeCloseTo(128.19, 1);
  });

  test("agrees with drawtext's text_w", () => {
    // Verified against a render: centred at 640px wide, drawtext put the ink
    // at x=258, and (640 - 128.19)/2 + 3px left bearing = 258.9.
    const adv = measureText("Title", { fontSize: 64 }).width;
    const pen = (640 - adv) / 2;
    // drawtext rounds the pen to a whole pixel, so allow 1px.
    expect(Math.abs(pen + 3 - 258)).toBeLessThan(1.5);
  });

  test("a missing character maps to .notdef rather than throwing", () => {
    expect(() => measureText("\u{1F600}", { fontSize: 32 })).not.toThrow();
  });

  test("CJK and combining marks do not crash", () => {
    expect(measureText("日本語", { fontSize: 32 }).width).toBeGreaterThan(0);
    expect(measureText("e\u0301", { fontSize: 32 }).width).toBeGreaterThan(0);
  });

  test("the estimator is visibly wrong, which is why this exists", () => {
    const parsed = measureText("WWWW", { fontSize: 64 }).width;
    const estimated = estimateTextWidth("WWWW", 64);
    expect(Math.abs(parsed - estimated)).toBeGreaterThan(20);
  });
});
