/**
 * Named caption presets — the "CapCut look" without hand-writing an options
 * object every time.
 *
 * A preset is just a `CaptionOptions` bundle plus a bundled font. It is
 * resolved *under* the caller's options, so anything passed explicitly still
 * wins:
 *
 * ```ts
 * s.addAll(captions(line, { preset: "shout" }));
 * s.addAll(captions(line, { preset: "shout", fontSize: 92 }));  // bigger
 * ```
 *
 * Why a separate layer rather than more defaults: the existing styles
 * (`karaoke`, `reveal`, `word`, `block`) answer *how words appear*, and are
 * orthogonal to *what they look like*. A preset pins both, because a
 * recognisable caption style is the whole package — Anton with a hairline
 * stroke is a different thing from Inter with a fat one.
 *
 * ## Fonts
 *
 * `shout` uses Anton, bundled in `assets/`. kino's default drawtext font is
 * Inter-Regular, which is wide and soft; heavy condensed grotesque is the
 * entire visual signature of this style, so the font is not optional. A
 * preset's font is passed through `CaptionOptions.text.fontFile`, which the
 * normalizer and the drawtext compiler already honour.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CaptionOptions } from "./index.js";
import { measureText } from "../measure/index.js";

/** A named look. Resolved under any options the caller passes. */
export interface CaptionPreset extends CaptionOptions {
  /**
   * Font file for the preset. Resolved against `assets/` when it is a bare
   * name, so `"Anton-Regular.ttf"` finds the bundled copy.
   */
  fontFile?: string;
  /**
   * Fraction of the frame width the text may occupy. Defaults to 0.9.
   *
   * Applied as `maxWidth` on every element, so the line wraps instead of
   * running off the edge, and as the ceiling for {@link fitFontSize}.
   */
  widthRatio?: number;
}

/**
 * Finds a bundled asset, walking up to the package root.
 *
 * Unbundled this module sits at `src/captions/`, in the tsup bundle at `dist/`.
 * Assuming either depth misses the other — and a missing font does not throw,
 * drawtext silently falls back to its own default, so the failure is a
 * quietly wrong-looking caption rather than an error. That is the same trap
 * `pipeline/compile.ts` documents for `defaultFontRef`.
 */
export function bundledAsset(name: string): string | undefined {
  let dir = resolve(
    typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url))
  );
  for (let i = 0; i < 5; i++) {
    const path = join(dir, "assets", name);
    if (existsSync(path)) return path;
    dir = dirname(dir);
  }
  return undefined;
}

/**
 * The built-in presets.
 *
 * `shout` is modelled on the heavy single-word captions used in Shorts: all
 * caps, one to three words, dead centre over the art, thick black stroke. It
 * deliberately does **not** sit in a bottom caption band — it covers the
 * picture, which is the point, and is why it suits clips whose speech balloons
 * are being dubbed over.
 */
export const CAPTION_PRESETS = {
  shout: {
    style: "word",
    fontFile: "Anton-Regular.ttf",
    fontSize: 96,
    y: "center",
    x: "center",
    color: "#ffffff",
    highlight: "#ffffff",
    // ~10% of cap height. Anton's caps are roughly 0.72em, so 96px text has
    // ~69px caps and a 7px stroke reads as heavy without eating the counters.
    text: {
      stroke: { color: "#000000", width: 7 },
      textAlign: "center",
    },
  },

  /**
   * The same face, but as a bottom-band subtitle line: smaller, more words,
   * with a shadow so it survives a busy panel without a box behind it.
   */
  "shout-band": {
    style: "karaoke",
    fontFile: "Anton-Regular.ttf",
    fontSize: 52,
    wordsPerLine: 4,
    y: "bottom-200",
    x: "center",
    color: "#ffffff",
    highlight: "#f5b544",
    text: {
      stroke: { color: "#000000", width: 5 },
      textAlign: "center",
    },
  },

  /**
   * Conventional subtitles: sentence case, regular weight, white with a thin
   * outline, bottom-centre.
   *
   * This is the style to reach for when the caption should be *read*, not
   * performed — long narration, or anything sitting in the letterbox bands
   * around a 4:3 panel. It uses kino's bundled Inter, so it needs no font
   * setup, and `reveal` keeps the words on screen once spoken rather than
   * colouring one at a time: a reading caption does not want a moving target.
   */
  plain: {
    style: "reveal",
    // Set explicitly rather than relying on the drawtext default: the accurate
    // wrap path only engages when a font file is known, and the estimator
    // misprices width badly enough to clip the line at both edges.
    fontFile: "Inter-Regular.ttf",
    fontSize: 44,
    wordsPerLine: 7,
    y: "bottom-120",
    x: "center",
    color: "#ffffff",
    highlight: "#ffffff",
    // Thin, because the outline is there to separate white text from a pale
    // panel — not to make the text look designed.
    text: {
      stroke: { color: "#000000", width: 3 },
      textAlign: "center",
    },
  },
} as const satisfies Record<string, CaptionPreset>;

export type CaptionPresetName = keyof typeof CAPTION_PRESETS;

/** `true` when `name` is a built-in preset. */
export function isCaptionPresetName(name: string): name is CaptionPresetName {
  return Object.prototype.hasOwnProperty.call(CAPTION_PRESETS, name);
}

/** Share of the frame width a caption may occupy. Leaves a margin each side. */
const MAX_WIDTH_RATIO = 0.9;

/** Below this, text is too small to read and overflowing is the lesser evil. */
const MIN_FONT_SIZE = 24;

/**
 * Shrinks `fontSize` until the widest single word fits the frame.
 *
 * Wrapping handles most overflow, but a word cannot be split — "ELECTRIC"
 * at 96px in a condensed face still runs past a 720px frame. Rather than let
 * it clip, the font comes down. Measured with real glyph advances, because the
 * character-class estimator prices Anton wrong enough that a line it reports as
 * fitting is visibly cut off at both edges.
 *
 * Returns the original size when the widest word already fits, so a preset's
 * declared size is respected whenever it can be.
 */
export function fitFontSize(
  words: string[],
  fontSize: number,
  frameWidth: number,
  fontFile?: string,
  widthRatio: number = MAX_WIDTH_RATIO
): number {
  if (!words.length || frameWidth <= 0) return fontSize;
  const limit = frameWidth * widthRatio;

  const widest = words.reduce((a, b) => (b.length > a.length ? b : a), words[0]);

  let size = fontSize;
  // Measure at the candidate size; `measureText` is linear in font size, so the
  // first overflow could be solved directly, but a loop keeps it obvious and
  // handles any non-linearity in the metrics.
  while (size > MIN_FONT_SIZE) {
    const { width } = measureText(widest, { fontSize: size, fontFile });
    if (width <= limit) break;
    size -= 2;
  }
  return Math.max(MIN_FONT_SIZE, size);
}

/**
 * Wrapping width for a caption, in pixels.
 *
 * `maxWidth` is what the normalizer wraps to, so this has to be set on every
 * caption element — a preset that sets a large font and no `maxWidth` is
 * exactly the "runs off both edges" bug.
 */
export function captionMaxWidth(frameWidth: number): number {
  return Math.round(frameWidth * MAX_WIDTH_RATIO);
}

/**
 * Merges a preset under caller options, then fits the result to the frame.
 *
 * Shallow at the top level, but `text` is merged one level deep so a caller can
 * override just `text.shadow` without dropping the preset's stroke. The
 * resolved `fontFile` is replaced with an absolute path, because drawtext
 * resolves a bare name against its own search path and would not find the
 * bundled copy.
 *
 * `frameWidth` and `text` drive the fit. Without them the preset still
 * resolves, but a large font in a condensed face can overflow the frame —
 * which is why every caller that knows the composition should pass both.
 */
export function resolveCaptionPreset(
  name: CaptionPresetName,
  options: CaptionOptions = {},
  frameWidth?: number,
  text?: string
): CaptionOptions {
  const preset: CaptionPreset = CAPTION_PRESETS[name];

  const fontFile = preset.fontFile;
  const resolvedFont = fontFile ? (bundledAsset(fontFile) ?? fontFile) : undefined;

  const { preset: _ignored, widthRatio, ...callerOptions } = options as CaptionOptions & {
    preset?: string;
    widthRatio?: number;
  };

  const merged: CaptionOptions = {
    ...preset,
    ...callerOptions,
    text: {
      ...(preset.text ?? {}),
      ...(callerOptions.text ?? {}),
      ...(resolvedFont ? { fontFile: callerOptions.text?.fontFile ?? resolvedFont } : {}),
    },
  };

  const ratio = widthRatio ?? preset.widthRatio ?? MAX_WIDTH_RATIO;

  // `widthRatio` rides on the element so the normalizer can turn it into a
  // pixel `maxWidth` once the canvas size is known. Captions are built inside a
  // scene callback, before `build()`, so the frame width is not available here.
  const withRatio = {
    ...merged,
    text: { ...merged.text, widthRatio: ratio } as CaptionOptions["text"],
  };

  if (frameWidth === undefined || frameWidth <= 0) return withRatio;

  const limit = Math.round(frameWidth * ratio);

  // Only shrink when the text actually overflows. A preset's declared size is
  // respected whenever the line fits.
  const declared = callerOptions.fontSize ?? preset.fontSize;
  let fontSize = merged.fontSize;
  if (typeof declared === "number" && text) {
    fontSize = fitFontSize(text.split(/\s+/).filter(Boolean), declared, frameWidth, resolvedFont, ratio);
  }

  return {
    ...withRatio,
    fontSize,
    text: {
      ...withRatio.text,
      maxWidth: withRatio.text?.maxWidth ?? limit,
    },
  };
}


