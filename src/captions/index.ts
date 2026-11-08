/**
 * Word-level captions from a measured line of speech.
 *
 * The text is already known — it is the `s.say()` line — so this never needs
 * speech recognition, only *when* each word is spoken.
 *
 * ```ts
 * const line = await voice("Where the mind is without fear.");
 *
 * comp.scene({ duration: { fit: line } }, (s) =>
 *   s.add(captions(line, { timing: "even" }))
 * );
 *
 * // or, with forced alignment when it is available:
 * comp.scene({ duration: { fit: line } }, async (s) =>
 *   s.addAll(await captionsAsync(line))
 * );
 * ```
 *
 * Timing comes from one of two places:
 *
 * - **Forced alignment** when `mms-forced-align` can be loaded. Exact, but it
 *   pulls `onnxruntime-node` and a ~317 MB model, so it is never a dependency:
 *   install it with `npx kino setup captions`, and the model downloads itself
 *   on first use into `~/.cache/kino/captions`.
 * - **Even distribution** otherwise, weighting each word by its length and
 *   pausing at punctuation. Needs nothing installed and is accurate for TTS,
 *   which reads at a steady pace.
 *
 * Either way the output is plain `TextElement`s, so captions mix with every
 * other element type and need no special renderer.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { estimateTextWidth } from "../normalize/element.js";
import { getFFmpegBinaryPath } from "../encoder/probe.js";
import { parsePixels } from "../normalize/unit-parser.js";
import type { ImageElement, TextElement, CaptionWord } from "../types/elements.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One spoken word and when it is heard, relative to the start of the line. */
export interface WordTiming {
  /** The word as written, punctuation included. */
  word: string;
  /** The same word with punctuation stripped — what an aligner is given. */
  clean: string;
  /** Start, in seconds from the beginning of the audio. */
  start: number;
  /** End, in seconds from the beginning of the audio. */
  end: number;
  /** 0–1 confidence, when the timing came from an aligner. */
  score?: number;
}

/** How words are timed. */
export type CaptionTiming = "auto" | "align" | "even";

export type CaptionStyle =
  /** Words appear in groups; the spoken word is highlighted. */
  | "karaoke"
  /** Words pop in one at a time and stay, so the line builds up as it is sung. */
  | "reveal"
  /** One word at a time, replacing the last. */
  | "word"
  /** A group appears together and stays; no per-word emphasis. */
  | "block";

export interface CaptionOptions {
  /**
   * How to time the words. `"auto"` uses forced alignment when
   * `mms-forced-align` is installed and falls back to even distribution.
   * `"align"` requires the package and throws without it; `"even"` never
   * tries to load it.
   */
  timing?: CaptionTiming;
  /** Defaults to `"karaoke"`. */
  style?: CaptionStyle;
  /** Words per caption for `karaoke` and `block`. Default 4. */
  wordsPerLine?: number;
  /** Break a line after a pause at least this long, in seconds. */
  gap?: number;
  /** Extra break pattern besides sentence endings, e.g. `/,$/`. */
  breakOn?: RegExp;
  /** Where the caption sits. Default `"bottom-240"`. */
  y?: number | string;
  /** Where the caption starts. Default `"center"`. */
  x?: number | string;
  /** Size of the caption text. Default 56. */
  fontSize?: number | string;
  /** Colour of words that are not being spoken. Default `#f8fafc`. */
  color?: string;
  /** Colour of the word being spoken. Default `#38bdf8`. */
  highlight?: string;
  /** Fade duration for each caption, in seconds. Default 0.12. */
  fade?: number;
  /** How long a finished caption lingers before disappearing. Default 0.35. */
  hold?: number;
  /** Z-index for the generated elements. Default 100. */
  zIndex?: number;
  /** Seconds to shift the whole caption track later. Default 0. */
  at?: number;
  /** Extra text options applied to every generated element. */
  text?: Partial<Omit<TextElement, "type" | "content" | "startAt" | "duration">>;
}

/** One caption on screen for a span of time, with its words. */
export interface CaptionLine {
  /** Start, in seconds from the beginning of the line. */
  start: number;
  /** End, in seconds from the beginning of the line. */
  end: number;
  words: WordTiming[];
  /** Plain text of the line, for debugging and tests. */
  text: string;
}

// ---------------------------------------------------------------------------
// Word splitting and timing
// ---------------------------------------------------------------------------

/** Splits a line into spoken words, keeping the written form. */
export function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** Strips punctuation, leaving the model's `a–z` + apostrophe vocabulary. */
export function cleanWord(word: string): string {
  return word.replace(/[^A-Za-z']/g, "");
}

const PAUSE_AFTER = /[,;:)\]]$/;
const LONG_PAUSE_AFTER = /[.!?]$/;

/**
 * Distributes `duration` seconds across words by weight.
 *
 * Weight is the word's length plus one, so a long word gets proportionally
 * more time than a short one — TTS pace tracks characters. A comma or full
 * stop adds a silent gap *after* that word rather than stretching the word
 * itself, which keeps the spoken words evenly paced.
 */
export function evenTimings(text: string, duration: number): WordTiming[] {
  const words = splitWords(text);
  if (!words.length) return [];

  const spoken = words.map((w) => cleanWord(w).length + 1);
  const gaps = words.map((w) => {
    if (LONG_PAUSE_AFTER.test(w)) return 3;
    if (PAUSE_AFTER.test(w)) return 1.5;
    return 0.6;
  });

  const spokenTotal = spoken.reduce((a, b) => a + b, 0);
  const gapTotal = gaps.reduce((a, b) => a + b, 0);
  // Pauses are capped at 30% of the line: a sentence break is not a third of
  // it, and a line of many short clauses must stay intelligible.
  const gapShare = Math.min(0.3, gapTotal / (spokenTotal + gapTotal));
  const gapScale = gapTotal > 0 ? (duration * gapShare) / gapTotal : 0;
  const spokenScale = spokenTotal > 0 ? (duration * (1 - gapShare)) / spokenTotal : 0;

  const out: WordTiming[] = [];
  let t = 0;
  for (let i = 0; i < words.length; i++) {
    const length = spoken[i] * spokenScale;
    out.push({ word: words[i], clean: cleanWord(words[i]), start: t, end: t + length });
    t += length + gaps[i] * gapScale;
  }

  // The gap budgeted after the final word is dead time: nothing follows it, so
  // extend the last word to the end of the audio instead of leaving the line
  // highlighted on nothing for the final few frames.
  const last = out[out.length - 1];
  if (last) last.end = Math.min(duration, Math.max(last.end, duration));
  return out;
}

// ---------------------------------------------------------------------------
// Forced alignment (optional)
// ---------------------------------------------------------------------------

/** Where the aligner's ONNX model is cached, mirroring the Piper voice cache. */
export function defaultCaptionCacheDir(): string {
  return join(homedir(), ".cache", "kino", "captions");
}

/**
 * Where the optional aligner is installed, separate from the project.
 *
 * Keeping it in Kino's cache means no manifest or lockfile changes, and one
 * copy is shared by every project on the machine — the same reasoning as the
 * Piper voices and the ONNX model.
 */
export function alignerInstallDir(): string {
  return join(defaultCaptionCacheDir(), "node_modules");
}

/** The directory `npm --prefix` installs into; it creates `node_modules` itself. */
export function alignerPrefixDir(): string {
  return defaultCaptionCacheDir();
}

/**
 * Installs `mms-forced-align` into {@link alignerInstallDir}.
 *
 * Uses `npm install --prefix`, which works regardless of the project's package
 * manager because the target directory is self-contained.
 */
export async function installAligner(): Promise<void> {
  const { spawnSync } = await import("node:child_process");
  const { mkdirSync } = await import("node:fs");
  // `--prefix` is the parent of `node_modules`; npm creates that itself.
  const dir = alignerPrefixDir();
  mkdirSync(dir, { recursive: true });

  const res = spawnSync(
    "npm",
    ["install", "--prefix", dir, "--no-audit", "--no-fund", "--loglevel", "error", "mms-forced-align"],
    { stdio: "inherit", timeout: 900_000 }
  );
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`npm exited with code ${res.status}`);

  // A new install invalidates a previous "not installed" result.
  cachedAligner = undefined;
}

let cachedAligner: Promise<any> | undefined;

/**
 * Loads `mms-forced-align`, or returns `undefined` when it is not installed.
 *
 * The package downloads its own model on first use; `cacheDir` points that
 * download at Kino's cache so it sits next to the Piper voices and is shared
 * between projects. The aligner is loaded once per process — loading the ONNX
 * session is the expensive part, not aligning.
 */
async function loadAligner(): Promise<any | undefined> {
  if (cachedAligner) return cachedAligner;

  cachedAligner = (async () => {
    let createAligner: ((options?: Record<string, unknown>) => Promise<any>) | undefined;

    // A project-local install is used when present, so a user who added it to
    // their own dependencies keeps control of the version.
    try {
      ({ createAligner } = await import("mms-forced-align" as string));
    } catch {
      createAligner = undefined;
    }

    // Otherwise fall back to the copy `kino setup captions` installed in the
    // shared cache. It is not on the normal resolution path, so it is loaded
    // by absolute path.
    if (!createAligner) {
      const { pathToFileURL } = await import("node:url");
      const { join } = await import("node:path");
      const { existsSync } = await import("node:fs");
      const entry = join(alignerInstallDir(), "mms-forced-align", "dist", "index.js");
      if (existsSync(entry)) {
        try {
          ({ createAligner } = await import(pathToFileURL(entry).href));
        } catch {
          createAligner = undefined;
        }
      }
    }

    if (!createAligner) return undefined;
    return createAligner({ quantized: true, cacheDir: defaultCaptionCacheDir() });
  })();

  // A failed load must not poison the cache for a later, working install.
  const loaded = await cachedAligner;
  if (!loaded) cachedAligner = undefined;
  return loaded;
}

/** True when word alignment is usable (the package is installed). */
export async function isAlignmentAvailable(): Promise<boolean> {
  return (await loadAligner()) !== undefined;
}

/**
 * Loads the aligner, which downloads its model on first use. Used by
 * `kino setup captions` so the first captioned render does not stall on a
 * 317 MB fetch.
 */
export async function warmAlignmentModel(): Promise<boolean> {
  const aligner = await loadAligner();
  if (!aligner) {
    throw new Error("mms-forced-align is not installed. Run `npx kino setup captions`.");
  }
  return true;
}

/** Decodes a WAV to the mono float PCM @16 kHz that the aligner requires. */
async function decodeForAlignment(file: string, ffmpegPath?: string): Promise<Float32Array> {
  const { spawnSync } = await import("node:child_process");
  // Prefer the binary Kino itself renders with: it is already resolved and
  // verified, and there is no reason to require a second ffmpeg on PATH.
  let bin = ffmpegPath;
  if (!bin) {
    try {
      const { getFFmpegBinaryPath } = await import("../encoder/probe.js");
      bin = getFFmpegBinaryPath();
    } catch {
      bin = undefined;
    }
  }
  const res = spawnSync(
    bin ?? "ffmpeg",
    ["-v", "error", "-i", file, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
    { maxBuffer: 1024 * 1024 * 256 }
  );
  if (res.error) {
    throw new Error(
      `Forced alignment needs ffmpeg on PATH to decode audio (${res.error.message}). ` +
        `Use { timing: "even" } to skip alignment.`
    );
  }
  if (res.status !== 0) {
    throw new Error(`ffmpeg failed to decode ${file} for alignment:\n${String(res.stderr).trim()}`);
  }
  const buf = res.stdout as Buffer;
  // Copy: the Buffer may be a pooled slice, and the aligner indexes the
  // ArrayBuffer directly.
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

/**
 * Times words with `mms-forced-align`, or returns `undefined` when the package
 * is not installed. Only a *missing package* degrades; a failure inside the
 * aligner is surfaced, because silently falling back would hide a bad model.
 */
async function alignTimings(file: string, words: string[]): Promise<WordTiming[] | undefined> {
  const aligner = await loadAligner();
  if (!aligner) return undefined;

  const audio = await decodeForAlignment(file);
  const clean = words.map(cleanWord);

  // The model's vocabulary is letters only. Words that reduce to nothing
  // ("—", "2024") are dropped from the alignment and get zero-length spans,
  // which is why the original index is tracked rather than the cleaned one.
  const alignable = clean
    .map((word, index) => ({ word, index }))
    .filter((entry) => entry.word.length > 0);
  if (!alignable.length) return undefined;

  const spans = await aligner.align(
    audio,
    16000,
    alignable.map((entry) => entry.word)
  );

  const out: WordTiming[] = words.map((word, i) => ({
    word,
    clean: clean[i],
    start: 0,
    end: 0,
  }));
  alignable.forEach((entry, i) => {
    const span = spans[i];
    if (!span) return;
    out[entry.index].start = span.start;
    out[entry.index].end = span.end;
    if (typeof span.score === "number") out[entry.index].score = span.score;
  });

  // Unalignable words have no span; give them a point at the next word's start
  // so the karaoke highlight does not stall on them.
  for (let i = 0; i < out.length; i++) {
    if (out[i].clean.length) continue;
    const next = out.slice(i + 1).find((w) => w.clean.length);
    const prev = out.slice(0, i).reverse().find((w) => w.clean.length);
    const at = next?.start ?? prev?.end ?? 0;
    out[i].start = at;
    out[i].end = at;
  }
  return out;
}

/**
 * Word timings for a line. Prefer {@link captions} / {@link captionsAsync},
 * which also build the elements; this is the lower-level hook.
 */
export async function timeWords(
  text: string,
  duration: number,
  file?: string,
  options: Pick<CaptionOptions, "timing"> = {}
): Promise<WordTiming[]> {
  const words = splitWords(text);
  if (!words.length) return [];

  const mode = options.timing ?? "auto";
  if (mode === "even") return evenTimings(text, duration);

  const aligned = file ? await alignTimings(file, words) : undefined;

  if (mode === "align" && !aligned) {
    throw new Error(
      `timing: "align" needs word alignment, which is unavailable.\n` +
        `  Install it with:  npx kino setup captions\n` +
        `  (pulls onnxruntime-node and a ~317 MB model on first use), or use { timing: "even" }.`
    );
  }

  // "auto": alignment when it is there, even distribution otherwise.
  return aligned ?? evenTimings(text, duration);
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/** Groups words into captions of at most `wordsPerLine`, breaking on sentence ends. */
/** Line-grouping options taken from the caption options. */
function groupOptions(options: CaptionOptions): GroupWordsOptions {
  return {
    wordsPerLine: options.wordsPerLine ?? 4,
    gap: options.gap,
    breakOn: options.breakOn,
  };
}

export interface GroupWordsOptions {
  /** Maximum words per caption. Default 4. */
  wordsPerLine?: number;
  /**
   * Break after a pause at least this long, in seconds. Songs have gaps between
   * phrases that punctuation alone does not mark.
   */
  gap?: number;
  /**
   * Extra break pattern, applied in addition to sentence endings. Pass a comma
   * pattern to break on clauses too.
   */
  breakOn?: RegExp;
}

export function groupWords(words: WordTiming[], wordsPerLine?: number): WordTiming[][];
export function groupWords(words: WordTiming[], options: GroupWordsOptions): WordTiming[][];
export function groupWords(
  words: WordTiming[],
  arg: number | GroupWordsOptions = {}
): WordTiming[][] {
  const opts: GroupWordsOptions = typeof arg === "number" ? { wordsPerLine: arg } : arg;
  const size = Math.max(1, Math.floor(opts.wordsPerLine ?? 4));
  const gap = opts.gap ?? Infinity;
  const extra = opts.breakOn;
  const groups: WordTiming[][] = [];
  let current: WordTiming[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    current.push(word);
    const next = words[i + 1];
    const pause = next ? next.start - word.end : Infinity;
    if (
      current.length >= size ||
      LONG_PAUSE_AFTER.test(word.word) ||
      (extra?.test(word.word) ?? false) ||
      pause >= gap
    ) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

/** Turns grouped words into timed captions, applying the trailing hold. */
export function buildCaptionLines(
  groups: WordTiming[][],
  options: Pick<CaptionOptions, "hold"> = {}
): CaptionLine[] {
  const hold = options.hold ?? 0.35;
  const lines: CaptionLine[] = groups.map((words) => ({
    start: words[0].start,
    end: words[words.length - 1].end + hold,
    words,
    text: words.map((w) => w.word).join(" "),
  }));

  // The hold after a line must not run into the next line: otherwise two
  // captions are on screen at once and their words overlap. Trim each hold to
  // the start of its successor, leaving a short gap when the speech allows.
  for (let i = 0; i < lines.length - 1; i++) {
    const nextStart = lines[i + 1].start;
    if (lines[i].end > nextStart) {
      const spoken = lines[i].words[lines[i].words.length - 1].end;
      lines[i].end = Math.max(spoken, nextStart - 0.02);
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

function baseOptions(
  options: CaptionOptions,
  startAt: number,
  duration: number
): Partial<TextElement> {
  return {
    x: options.x ?? "center",
    y: options.y ?? "bottom-240",
    textAlign: "center",
    zIndex: options.zIndex ?? 100,
    startAt,
    // A zero-length drawtext run never shows; keep a visible minimum.
    duration: Math.max(0.05, duration),
    ...options.text,
  };
}

/** Rendered width of `text` at `fontSize`, using the renderer's estimator. */
function measure(text: string, fontSize: number): number {
  return estimateTextWidth(text, fontSize);
}

/**
 * Word-by-word reveal: each word is its own element, appearing when it is sung
 * and staying until the line ends, so the sentence builds up as it is heard.
 *
 * Two things make this work with drawtext:
 *
 * - Each element is placed at an explicit pixel `x`, computed from the width of
 *   the words before it. Centring every element would stack them on top of each
 *   other, since each one holds only a single word.
 * - The word being sung is drawn in `highlight`; once the next word starts, an
 *   overlapping element redraws it in `color` until the line ends. That keeps
 *   the current word standing out without needing per-glyph colouring.
 */
function revealElements(
  timings: WordTiming[],
  options: CaptionOptions,
  ctx: { fontSize: number | string; color: string; highlight: string; fade: number; at: number }
): TextElement[] {
  const { color, highlight, fade, at } = ctx;
  const fontSize = parsePixels(ctx.fontSize) ?? 56;
  const lines = buildCaptionLines(groupWords(timings, groupOptions(options)), options);
  const out: TextElement[] = [];
  const zIndex = options.zIndex ?? 100;

  for (const line of lines) {
    const lineStart = at + line.start;
    const lineEnd = lineStart + (line.end - line.start);
    const lineLeft = resolveAnchor(options.x, measure(line.text, fontSize));

    let before = 0;
    for (let i = 0; i < line.words.length; i++) {
      const word = line.words[i];
      const wordStart = at + word.start;
      const next = line.words[i + 1];
      const nextStart = next ? at + next.start : lineEnd;
      const wordX = lineLeft + before;

      const base = {
        type: "text" as const,
        content: word.word,
        fontSize,
        // Positioned from the frame centre, not from `w` directly: drawtext
        // resolves `w-210` to 960-210 measured from the right edge, which
        // pushed every word off-screen. `w/2 +/- n` is unambiguous.
        x: `w/2${wordX < 0 ? "-" : "+"}${Math.abs(wordX).toFixed(3)}`,
        y: options.y ?? "bottom-240",
        textAlign: "left" as const,
        zIndex,
        ...options.text,
      };

      // While this word is being sung it is highlighted...
      out.push({
        ...base,
        fontColor: highlight,
        startAt: wordStart,
        duration: Math.max(0.05, Math.min(nextStart, lineEnd) - wordStart),
        animation: { opacity: { from: 0, to: 1, duration: fade, easing: "easeOut" } },
      } as TextElement);

      // ...then it settles into the resting colour for the rest of the line.
      const settledFor = lineEnd - nextStart;
      if (settledFor > 0.05) {
        out.push({
          ...base,
          fontColor: color,
          startAt: Math.max(wordStart, nextStart),
          duration: settledFor,
        } as TextElement);
      }

      // Advance by this word plus the space that separates it from the next.
      // The space is added explicitly: measuring "word " would count a trailing
      // space drawtext never draws, drifting the line right by a space per word.
      before += measure(word.word, fontSize) + measure(" ", fontSize);
    }
  }

  return out;
}

/**
 * Turns a caption `x` option into a left-edge pixel offset for a line of
 * `width`, so reveal elements can be positioned individually.
 */
function resolveAnchor(x: number | string | undefined, width: number): number {
  if (typeof x === "number") return x;
  const value = (x ?? "center").trim();
  if (value === "center" || value === "c") return -width / 2;
  if (value === "left") return 0;
  if (value === "right") return -width;
  return parsePixels(value) ?? -width / 2;
}

/**
 * Builds caption elements from word timings.
 *
 * Returned elements are relative to the scene, offset by `options.at`.
 */
export function captionElements(
  timings: WordTiming[],
  options: CaptionOptions = {}
): TextElement[] {
  const style = options.style ?? "karaoke";
  const fontSize = options.fontSize ?? 56;
  const color = options.color ?? "#f8fafc";
  const highlight = options.highlight ?? "#38bdf8";
  const fade = options.fade ?? 0.12;
  const at = options.at ?? 0;

  if (!timings.length) return [];

  if (style === "word") {
    // One word at a time: the word changing is the emphasis, so no highlight.
    return timings.map(
      (word) =>
        ({
          type: "text",
          content: word.word,
          fontSize,
          fontColor: color,
          animation: { opacity: { from: 0, to: 1, duration: fade, easing: "easeOut" } },
          ...baseOptions(options, at + word.start, word.end - word.start + (options.hold ?? 0.35)),
        }) as TextElement
    );
  }

  if (style === "reveal") {
    return revealElements(timings, options, { fontSize, color, highlight, fade, at });
  }

  const lines = buildCaptionLines(groupWords(timings, groupOptions(options)), options);

  return lines.map((line) => {
    const lineStart = at + line.start;
    const lineDuration = line.end - line.start;

    // Karaoke: one element holding the full line, plus the per-word timings.
    // The pipeline draws the line in `fontColor` and re-draws each word in
    // `highlight` for its span, clipped to the word's box — so the highlight
    // sits exactly over the word inside the line rather than on a separate
    // copy of the text.
    const captionWords: CaptionWord[] =
      style === "karaoke"
        ? line.words.map((w) => ({
            word: w.word,
            at: w.start - line.start,
            duration: Math.max(0.05, w.end - w.start),
          }))
        : [];

    return {
      type: "text",
      content: line.text,
      fontSize,
      fontColor: color,
      ...(captionWords.length ? { captionWords, highlight } : {}),
      animation: { opacity: { from: 0, to: 1, duration: fade, easing: "easeOut" } },
      ...baseOptions(options, lineStart, lineDuration),
    } as TextElement;
  });
}

/**
 * Captions for a measured line using even timing — no model, no dependency.
 *
 * ```ts
 * const line = await voice("Where the mind is without fear.");
 * comp.scene({ duration: { fit: line } }, (s) => s.add(captions(line)));
 * ```
 */
export function captions(
  voice: { text: string; seconds: number },
  options: CaptionOptions = {}
): TextElement[] {
  const timing = options.timing ?? "even";
  if (timing !== "even") {
    throw new Error(
      `captions() cannot align audio synchronously. Use { timing: "even" } ` +
        `or \`await captionsAsync(voice, options)\`.`
    );
  }
  return captionElements(evenTimings(voice.text, voice.seconds), { ...options, timing });
}

/**
 * Captions for a measured line, using forced alignment when it is available.
 *
 * ```ts
 * const line = await voice("Where the mind is without fear.");
 * const cap = await captionsAsync(line);   // measured once, reused per scene
 * comp.scene({ duration: { fit: line } }, (s) => s.addAll(cap));
 * ```
 */
export async function captionsAsync(
  voice: { text: string; seconds: number; path?: string },
  options: CaptionOptions = {}
): Promise<TextElement[]> {
  const timings = await timeWords(voice.text, voice.seconds, voice.path, options);
  return captionElements(timings, options);
}

// ---------------------------------------------------------------------------
// Image-based karaoke
// ---------------------------------------------------------------------------

/**
 * The vendored Linux ffmpeg, when it exists and can draw text.
 *
 * `getFFmpegBinaryPath()` locates `vendor/` relative to the compiled module,
 * which assumes a fixed `dist/` depth; tsup splits output into hashed chunks,
 * so the relative path can point outside the package. Walking up to the
 * package root instead works however the bundle is laid out.
 */
function findDrawtextFfmpeg(): string | undefined {
  if (process.platform !== "linux") return undefined;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const bin = join(dir, "vendor", "linux", process.arch, "ffmpeg");
    if (existsSync(bin)) return bin;
    dir = dirname(dir);
  }
  return undefined;
}

export interface CaptionImageOptions extends CaptionOptions {
  /**
   * Size of the PNG strip. This is the *rendering* size: pass a multiple of the
   * on-screen size (e.g. 2x) for crisp text, and set `displayWidth` /
   * `displayHeight` to the size it should occupy.
   */
  width: number;
  /** Height of the PNG strip, in pixels. See `width`. */
  height: number;
  /** On-screen width. Defaults to `width`, i.e. 1:1 with the PNG. */
  displayWidth?: number;
  /** On-screen height. Defaults to `height`, i.e. 1:1 with the PNG. */
  displayHeight?: number;
  /** Where to write the PNGs. */
  dir: string;
  /** Font used to draw the line. */
  fontFile?: string;
  /** ffmpeg binary used to rasterise. */
  ffmpegPath?: string;
  /** Where the strip is placed on the composition frame. Defaults to 0. */
  x?: number;
  /** Where the strip is placed on the composition frame. Defaults to 0. */
  y?: number;
}

/**
 * Karaoke captions as pre-rendered images, one per word.
 *
 * The text-based highlight draws the line again for every word, and ffmpeg has
 * to keep a full-frame copy per word alive — with several lines on screen that
 * collapses and the render never finishes. Here each word's state is
 * rasterised once to a PNG, and the composition only swaps images on a
 * timeline, which costs the same per frame no matter how many words there are.
 *
 * Returns one image element per word, timed to that word.
 */
export async function captionImages(
  timings: WordTiming[],
  options: CaptionImageOptions
): Promise<ImageElement[]> {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { spawnSync } = await import("node:child_process");

  // Same resolution as the renderer, so the bundled binary is used when the
  // system has no ffmpeg on PATH. `drawtext` is required here, and some
  // `ffmpeg-static` builds lack it, so the vendored build is preferred when
  // it exists next to the package.
  const ffmpeg = options.ffmpegPath ?? findDrawtextFfmpeg() ?? getFFmpegBinaryPath();
  const fontSize = parsePixels(options.fontSize) ?? 56;
  const color = options.color ?? "#f8fafc";
  const highlight = options.highlight ?? "#38bdf8";
  const at = options.at ?? 0;
  const width = options.width;
  const height = options.height;
  mkdirSync(options.dir, { recursive: true });

  const font = options.fontFile ? `:fontfile='${options.fontFile}'` : "";
  const out: ImageElement[] = [];
  let probeCount = 0;

  /**
   * Rendered advance of `text` at this size, in pixels.
   *
   * The character-class estimator is only approximate, and a few pixels of
   * error per word is enough to close the gaps between words. Rasterising the
   * text once and finding its ink extent gives the exact advance the layout
   * needs.
   */
  const advance = (text: string): number => {
    const probe = join(options.dir, `probe-${probeCount++}.txt`);
    writeFileSync(probe, text, "utf8");
    const res = spawnSync(
      ffmpeg,
      [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "color=c=black:s=2400x120:d=1,format=gray",
        "-vf", `drawtext=textfile='${probe}'${font}:fontsize=${fontSize}:fontcolor=white:x=10:y=10`,
        "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-",
      ],
      { maxBuffer: 64 * 1024 * 1024 }
    );
    if (res.status !== 0 || !res.stdout) return estimateTextWidth(text, fontSize);
    const buf = res.stdout as Buffer;
    const W = 2400;
    let hi = -1;
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < 120; y++) {
        if (buf[y * W + x] > 40) {
          hi = x;
          break;
        }
      }
    }
    // The pen origin sits at x=10; ink can start slightly right of it, so the
    // advance is measured from the pen origin to the rightmost lit column.
    return hi < 0 ? estimateTextWidth(text, fontSize) : hi - 10 + 1;
  };

  // Group into lines the same way the other styles do. All timings go in at
  // once: `buildCaptionLines` trims each line's hold so it cannot run into the
  // next line, and that only works when it can see the following line. Calling
  // this per line leaves the holds untrimmed and stacks lines on top of each
  // other.
  const lines = buildCaptionLines(groupWords(timings, groupOptions(options)), options);

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const lineEnd = at + line.end;

    // Measure every word once, plus the space that separates them.
    const widths = line.words.map((w) => advance(w.word));
    const space = advance("a a") - advance("aa");

    for (let wi = 0; wi < line.words.length; wi++) {
      const parts = line.words.map((w, j) => ({
        text: w.word,
        colour: j === wi ? highlight : color,
      }));

      const total = widths.reduce((a, b) => a + b, 0) + space * (widths.length - 1);
      let x = (width - total) / 2;

      const filters: string[] = [];
      for (let k = 0; k < parts.length; k++) {
        const txt = join(options.dir, `l${li}-w${wi}-${k}.txt`);
        writeFileSync(txt, parts[k].text, "utf8");
        filters.push(
          `drawtext=textfile='${txt}'${font}:fontsize=${fontSize}:fontcolor=${parts[k].colour}:x=${x.toFixed(2)}:y=${Math.round(height * 0.2)}`
        );
        x += widths[k] + space;
      }

      const png = join(options.dir, `l${li}-w${wi}.png`);
      const res = spawnSync(
        ffmpeg,
        [
          "-hide_banner", "-loglevel", "error", "-y",
          "-f", "lavfi", "-i", `color=c=black@0.0:s=${width}x${height}:d=1,format=rgba`,
          "-vf", filters.join(","),
          "-frames:v", "1", png,
        ],
        { encoding: "utf8" }
      );
      if (res.status !== 0) {
        const detail = res.stderr?.trim() || res.error?.message || `exit code ${res.status}`;
        throw new Error(`Failed to rasterise caption word ${wi}: ${detail}`);
      }

      const wordStart = at + line.words[wi].start;
      const nextStart = wi + 1 < line.words.length ? at + line.words[wi + 1].start : lineEnd;
      out.push({
        type: "image",
        src: png,
        width: options.displayWidth ?? width,
        height: options.displayHeight ?? height,
        startAt: wordStart,
        duration: Math.max(0.05, Math.min(nextStart, lineEnd) - wordStart),
        zIndex: options.zIndex ?? 100,
        x: options.x ?? 0,
        y: options.y ?? 0,
      });
    }
  }

  return out;
}
