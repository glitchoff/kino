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
import { homedir } from "node:os";
import { join } from "node:path";
import type { TextElement, CaptionWord } from "../types/elements.js";

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
export function groupWords(words: WordTiming[], wordsPerLine: number): WordTiming[][] {
  const size = Math.max(1, Math.floor(wordsPerLine));
  const groups: WordTiming[][] = [];
  let current: WordTiming[] = [];

  for (const word of words) {
    current.push(word);
    if (current.length >= size || LONG_PAUSE_AFTER.test(word.word)) {
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

  const lines = buildCaptionLines(groupWords(timings, options.wordsPerLine ?? 4), options);

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
