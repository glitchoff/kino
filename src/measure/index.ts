import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { estimateTextWidth } from "../normalize/element.js";
import { getFFmpegBinaryPath } from "../encoder/probe.js";

/**
 * Same walk-up as the ffmpeg lookup: unbundled this module sits at
 * `src/measure/`, in the tsup bundle at `dist/`, so the depth is not fixed.
 * Getting this wrong does not fail loudly — it silently measures with
 * drawtext's default font instead of the one the renderer draws with.
 */
function findDefaultFont(): string | undefined {
  let dir = resolve(
    typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url))
  );
  for (let i = 0; i < 5; i++) {
    const candidates = [
      join(dir, "assets", "Inter-Regular.ttf"),
      join(dir, "assets", "inter-regular.ttf"),
    ];
    for (const c of candidates) if (existsSync(c)) return c;
    dir = dirname(dir);
  }
  return undefined;
}

const DEFAULT_FONT_PATH = findDefaultFont();

export interface MeasureTextOptions {
  /** Font size in pixels. Default 48. */
  fontSize?: number;
  /** Font file. Defaults to the bundled Inter, matching the renderer. */
  fontFile?: string;
  /**
   * FFmpeg binary. Defaults to the vendored build when the package ships one,
   * because `drawtext` is required and some `ffmpeg-static` builds lack it.
   */
  ffmpegPath?: string;
}

/** Which backend answered a measurement. */
export type MeasureSource = "raster" | "estimate";

export interface TextMeasurement {
  /** Advance width in pixels. */
  width: number;
  /** Height of the tallest line's ink, in pixels. */
  height: number;
  /** `raster` when measured by drawing, `estimate` when ffmpeg was unusable. */
  source: MeasureSource;
}

const RASTER_W = 2400;
const RASTER_H = 160;
const PEN_X = 10;
const PEN_Y = 10;
const INK_THRESHOLD = 40;

/**
 * Same walk-up as `findDrawtextFfmpeg` and `resolveVendoredFFmpeg`: unbundled
 * this module sits at `src/measure/`, in the tsup bundle at `dist/`, so the
 * depth is not fixed.
 */
function findVendoredFfmpeg(): string | undefined {
  if (process.platform !== "linux") return undefined;
  if (process.arch !== "x64" && process.arch !== "arm64") return undefined;
  // Resolve absolutely: tsup emits a relative `__dirname`, and spawn() would
  // look for `vendor/...` relative to the caller's cwd.
  let dir = resolve(
    typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url))
  );
  for (let i = 0; i < 5; i++) {
    const bin = join(dir, "vendor", "linux", process.arch, "ffmpeg");
    if (existsSync(bin)) return bin;
    dir = dirname(dir);
  }
  return undefined;
}

let warned = false;

/**
 * Resolve the binary used for measurement, preferring one that can `drawtext`.
 */
function resolveFfmpeg(options: MeasureTextOptions): string {
  return options.ffmpegPath ?? findVendoredFfmpeg() ?? getFFmpegBinaryPath();
}

interface RawBox {
  width: number;
  height: number;
}

/**
 * Draw every string once and report the ink box of each.
 *
 * One ffmpeg invocation per string: measuring a paragraph word by word would be
 * ~20 ms each, which is fine for layout code but not for wrapping. Batch the
 * strings you care about and measure once.
 */
function rasterise(texts: string[], options: MeasureTextOptions): RawBox[] | undefined {
  const fontSize = options.fontSize ?? 48;
  const fontFile = options.fontFile ?? DEFAULT_FONT_PATH;
  const font = fontFile ? `:fontfile='${fontFile.replace(/\\/g, "/").replace(/:/g, "\\:")}'` : "";
  const bin = resolveFfmpeg(options);

  const dir = mkdtempSync(join(tmpdir(), "kino-measure-"));
  try {
    return texts.map((text, i) => {
      const probe = join(dir, `t-${i}.txt`);
      writeFileSync(probe, text, "utf8");
      const res = spawnSync(
        bin,
        [
          "-hide_banner", "-loglevel", "error", "-y",
          "-f", "lavfi", "-i", `color=c=black:s=${RASTER_W}x${RASTER_H}:d=1,format=gray`,
          "-vf",
          `drawtext=textfile='${probe}'${font}:fontsize=${fontSize}:fontcolor=white:x=${PEN_X}:y=${PEN_Y}`,
          "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-",
        ],
        { maxBuffer: 64 * 1024 * 1024 }
      );
      if (res.status !== 0 || !res.stdout) return { width: -1, height: -1 };
      const buf = res.stdout as Buffer;

      let lo = RASTER_W;
      let hi = -1;
      let top = RASTER_H;
      let bottom = -1;
      for (let y = 0; y < RASTER_H; y++) {
        const row = y * RASTER_W;
        for (let x = 0; x < RASTER_W; x++) {
          if (buf[row + x] > INK_THRESHOLD) {
            if (x < lo) lo = x;
            if (x > hi) hi = x;
            if (y < top) top = y;
            if (y > bottom) bottom = y;
          }
        }
      }
      if (hi < 0) return { width: 0, height: 0 };
      // Ink can start right of the pen origin; the advance is measured from the
      // pen origin to the rightmost lit column, which is what layout needs.
      return { width: hi - PEN_X + 1, height: bottom - top + 1 };
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function estimated(text: string, fontSize: number): RawBox {
  return { width: estimateTextWidth(text, fontSize), height: fontSize * 0.75 };
}

/**
 * Measure the rendered advance of one string, in pixels.
 *
 * Rasterises the text and finds its ink extent. The character-class estimator
 * is only approximate — it under-measures by a few pixels per word, which is
 * enough to close gaps between words in captions and to misplace a right- or
 * centre-aligned block.
 *
 * Falls back to the estimator when ffmpeg cannot be run, reporting
 * `source: "estimate"` so callers can tell.
 */
export async function measureText(
  text: string,
  options: MeasureTextOptions = {}
): Promise<TextMeasurement> {
  const fontSize = options.fontSize ?? 48;
  if (!text) return { width: 0, height: 0, source: "raster" };
  const [box] = rasterise([text], options) ?? [];
  if (!box || box.width < 0) {
    if (!warned) {
      warned = true;
      process.emitWarning(
        "kino: text measurement fell back to the approximate estimator; ffmpeg with drawtext was not usable.",
        "KinoWarning"
      );
    }
    const e = estimated(text, fontSize);
    return { ...e, source: "estimate" };
  }
  return { ...box, source: "raster" };
}

/**
 * Measure many strings in one call.
 *
 * Each string is still one ffmpeg run, but they share a temporary directory and
 * the resolved binary. Use this rather than looping over `measureText`.
 */
export async function measureTexts(
  texts: string[],
  options: MeasureTextOptions = {}
): Promise<TextMeasurement[]> {
  const fontSize = options.fontSize ?? 48;
  if (texts.length === 0) return [];
  const boxes = rasterise(texts, options);
  if (!boxes || boxes.some((b) => b.width < 0)) {
    return texts.map((t) => ({ ...estimated(t, fontSize), source: "estimate" as const }));
  }
  return boxes.map((b) => ({ ...b, source: "raster" as const }));
}

/**
 * Width of a single space at this size, measured as the advance difference
 * between `"a a"` and `"aa"`. drawtext does not draw a trailing space, so
 * measuring `" "` alone reads as zero.
 */
export async function measureSpace(options: MeasureTextOptions = {}): Promise<number> {
  const [both, joined] = await measureTexts(["a a", "aa"], options);
  return Math.max(0, both.width - joined.width);
}

/** The bundled font path, when it exists. */
export function defaultFontFile(): string | undefined {
  return DEFAULT_FONT_PATH;
}
