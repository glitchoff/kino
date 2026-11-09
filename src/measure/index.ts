import { advanceWidth, bundledFontFile, loadFontMetrics } from "./font.js";
import { estimateTextWidth } from "../normalize/element.js";

export { bundledFontFile as defaultFontFile } from "./font.js";
export type { FontMetrics } from "./font.js";

export interface MeasureTextOptions {
  /** Font size in pixels. Default 48. */
  fontSize?: number;
  /** Font file. Defaults to the bundled Inter, matching the renderer. */
  fontFile?: string;
  /**
   * Ignored. Kept so callers written against the ffmpeg-backed version still
   * compile; measurement no longer shells out.
   */
  ffmpegPath?: string;
}

/** Which backend answered a measurement. */
export type MeasureSource = "font" | "estimate";

export interface TextMeasurement {
  /** Advance width in pixels. */
  width: number;
  /** Height of one line, in pixels (font size × 1.2, as drawtext uses). */
  height: number;
  /** `font` when read from the font file, `estimate` when it could not be. */
  source: MeasureSource;
}

function estimateMeasurement(text: string, fontSize: number): TextMeasurement {
  return { width: estimateTextWidth(text, fontSize), height: fontSize * 1.2, source: "estimate" };
}

/**
 * Measure the rendered advance of one string, in pixels.
 *
 * Reads the advance widths out of the font file, which is the number drawtext
 * uses for `text_w` — so a layout computed from this lands exactly where the
 * render does. Synchronous, no subprocess.
 *
 * Falls back to the character-class estimator only when the font file cannot be
 * read, reporting `source: "estimate"` so callers can tell.
 */
export function measureText(text: string, options: MeasureTextOptions = {}): TextMeasurement {
  const fontSize = options.fontSize ?? 48;
  if (!text) return { width: 0, height: fontSize * 1.2, source: "font" };

  const fontFile = options.fontFile ?? bundledFontFile();
  if (!fontFile) return estimateMeasurement(text, fontSize);

  try {
    const metrics = loadFontMetrics(fontFile);
    return { width: advanceWidth(metrics, text, fontSize), height: fontSize * 1.2, source: "font" };
  } catch {
    return estimateMeasurement(text, fontSize);
  }
}

/**
 * Measure many strings.
 *
 * Kept for API compatibility with the rasterised version; each call is now pure
 * arithmetic, so there is nothing to batch.
 */
export function measureTexts(
  texts: string[],
  options: MeasureTextOptions = {}
): TextMeasurement[] {
  return texts.map((t) => measureText(t, options));
}

/**
 * Width of a single space at this size.
 *
 * drawtext does not draw a trailing space, so this is the font's space advance
 * rather than a measured gap.
 */
export function measureSpace(options: MeasureTextOptions = {}): number {
  return measureText(" ", options).width;
}
