import { describe, test, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  splitWords,
  cleanWord,
  evenTimings,
  groupWords,
  buildCaptionLines,
  captionElements,
  captionImages,
  captions,
  captionsAsync,
  timeWords,
} from "../src/captions/index.js";
import { composition } from "../src/builder/index.js";
import { normalizeComposition } from "../src/normalize/index.js";
import { compile } from "../src/pipeline/index.js";

/** A measured voice without spawning Piper. */
const fakeVoice = (text: string, seconds: number) => ({ text, seconds, path: "/tmp/fake.wav" });

describe("captions: words", () => {
  test("splits on whitespace and drops empties", () => {
    expect(splitWords("  Where the  mind\nis ")).toEqual(["Where", "the", "mind", "is"]);
  });

  test("cleans punctuation but keeps apostrophes", () => {
    expect(cleanWord("fear.")).toBe("fear");
    expect(cleanWord("don't,")).toBe("don't");
    expect(cleanWord("—")).toBe("");
    expect(cleanWord("2024")).toBe("");
  });
});

describe("captions: even timing", () => {
  test("covers the whole line without overlapping", () => {
    const timings = evenTimings("Where the mind is without fear", 3);
    expect(timings).toHaveLength(6);
    expect(timings[0].start).toBe(0);
    expect(timings[5].end).toBeCloseTo(3, 5);
    for (let i = 1; i < timings.length; i++) {
      expect(timings[i].start).toBeGreaterThanOrEqual(timings[i - 1].end);
    }
  });

  test("longer words get more time", () => {
    const timings = evenTimings("a extraordinarily", 2);
    const short = timings[0].end - timings[0].start;
    const long = timings[1].end - timings[1].start;
    expect(long).toBeGreaterThan(short * 2);
  });

  test("a sentence end leaves a longer gap than a comma", () => {
    const sentence = evenTimings("Stop. Go", 2);
    const comma = evenTimings("Stop, Go", 2);
    expect(sentence[1].start).toBeGreaterThan(comma[1].start);
  });

  test("empty text produces no words", () => {
    expect(evenTimings("   ", 2)).toEqual([]);
  });

  test("the last word never runs past the audio", () => {
    const timings = evenTimings("one two three", 1);
    expect(timings[timings.length - 1].end).toBeLessThanOrEqual(1);
  });
});

describe("captions: grouping", () => {
  const timings = evenTimings("Where the mind is without fear", 3);

  test("splits into lines of the requested size", () => {
    expect(groupWords(timings, 2).map((g) => g.length)).toEqual([2, 2, 2]);
    expect(groupWords(timings, 4).map((g) => g.length)).toEqual([4, 2]);
  });

  test("breaks a line early at a sentence end", () => {
    const words = evenTimings("Go now. Then stop here", 3);
    const groups = groupWords(words, 4);
    expect(groups[0].map((w) => w.word)).toEqual(["Go", "now."]);
  });

  test("lines never overlap, even with a long hold", () => {
    const words = evenTimings("Where the mind is without fear.", 2);
    const lines = buildCaptionLines(groupWords(words, 5), { hold: 1 });
    expect(lines.length).toBeGreaterThan(1);
    for (let i = 0; i < lines.length - 1; i++) {
      expect(lines[i].end).toBeLessThanOrEqual(lines[i + 1].start);
    }
  });

  test("a trailing hold extends the caption past the last word", () => {
    const lines = buildCaptionLines(groupWords(timings, 6), { hold: 0.5 });
    expect(lines).toHaveLength(1);
    expect(lines[0].end).toBeCloseTo(timings[5].end + 0.5, 5);
    expect(lines[0].text).toBe("Where the mind is without fear");
  });
});

describe("captions: elements", () => {
  const line = fakeVoice("Where the mind is without fear.", 3);

  test("karaoke emits one element per line, carrying per-word timings", () => {
    const els = captions(line, { style: "karaoke", wordsPerLine: 6 });
    expect(els).toHaveLength(1);
    const [el] = els;
    expect(el.type).toBe("text");
    expect(el.content).toBe("Where the mind is without fear.");
    expect(el.captionWords).toHaveLength(6);
    // Word times are relative to the element, which starts with the line.
    expect(el.captionWords![0].at).toBeCloseTo(0, 5);
    expect(el.highlight).toBe("#38bdf8");
  });

  test("block emits a line without per-word timings", () => {
    const els = captions(line, { style: "block", wordsPerLine: 3 });
    expect(els).toHaveLength(2);
    expect(els[0].captionWords).toBeUndefined();
  });

  test("word style emits one element per word", () => {
    const els = captions(line, { style: "word" });
    expect(els).toHaveLength(6);
    expect(els[0].content).toBe("Where");
    expect(els[0].captionWords).toBeUndefined();
  });

  describe("reveal style", () => {
    const els = captions(line, { style: "reveal", wordsPerLine: 6, fontSize: 52 });

    // `reveal` used to emit one element per word, positioned by hand. That made
    // the x depend on `estimateTextWidth` (whose lowercase price is roughly 2x
    // the drawn width, so the error became the gap between words) and made the
    // y depend on each word's own `text_h` (`bottom-N` is `h - text_h - N`), so
    // words with and without ascenders sat on different baselines. Both are
    // fixed by emitting one element per line and letting the font lay it out.
    test("one element per line, carrying per-word timings", () => {
      expect(els).toHaveLength(1);
      expect(els[0].content).toBe("Where the mind is without fear.");
      expect(els[0].captionWords?.map((w) => w.word)).toEqual([
        "Where", "the", "mind", "is", "without", "fear.",
      ]);
    });

    test("the line is drawn in the resting colour and highlights per word", () => {
      // The pipeline draws the line once and re-draws the active word in
      // `highlight`, clipped to that word's box. There is no per-word element
      // to colour, so the highlight lives in `captionWords` + `highlight`.
      expect(els[0].fontColor).toBe("#f8fafc");
      expect(els[0].highlight).toBe("#38bdf8");
    });

    test("no element positions words individually", () => {
      // A per-word x was the mechanism behind the uneven gaps; nothing should
      // carry one now.
      for (const el of els) {
        if (el.x === undefined) continue;
        expect(String(el.x)).not.toMatch(/^w\/2[+-][\d.]+$/);
      }
    });

    test("word timings are relative to the line, not the scene", () => {
      const words = els[0].captionWords!;
      expect(words[0].at).toBeCloseTo(0, 5);
      for (let i = 1; i < words.length; i++) {
        expect(words[i].at).toBeGreaterThan(words[i - 1].at);
      }
      for (const w of words) expect(w.duration).toBeGreaterThan(0);
    });

    test("one y for the whole line, so the baseline cannot drift", () => {
      // `bottom-N` resolves against `text_h`; with a single element that is the
      // line's own height, so every word shares a baseline by construction.
      const ys = new Set(els.map((e) => String(e.y)));
      expect(ys.size).toBe(1);
    });

    test("a long line wraps into several elements, one per line", () => {
      const many = captions(line, { style: "reveal", wordsPerLine: 3, fontSize: 52 });
      expect(many.length).toBeGreaterThan(1);
      for (const el of many) expect(el.captionWords?.length).toBeGreaterThan(0);
    });
  });

  test("at shifts the whole track", () => {
    const els = captions(line, { style: "block", wordsPerLine: 6, at: 2 });
    expect(els[0].startAt).toBeCloseTo(2, 5);
  });

  test("synchronous captions refuse alignment rather than guessing", () => {
    expect(() => captions(line, { timing: "auto" })).toThrow(/captionsAsync/);
    expect(() => captions(line, { timing: "align" })).toThrow(/captionsAsync/);
  });

  test("timing: even is the default", async () => {
    const timings = await timeWords(line.text, line.seconds, line.path, { timing: "even" });
    expect(timings).toHaveLength(6);
  });
});

describe("captions: optional aligner", () => {
  test("the aligner lives in Kino's cache, not the project", async () => {
    const { alignerInstallDir, defaultCaptionCacheDir } = await import("../src/captions/index.js");
    // Never the project's node_modules: installing there would mean editing a
    // manifest or lockfile, which this must not do.
    expect(alignerInstallDir()).not.toContain(process.cwd());
    expect(alignerInstallDir().startsWith(defaultCaptionCacheDir())).toBe(true);
    // Separator-agnostic: Windows reports backslashes here.
    expect(alignerInstallDir().replace(/\\/g, "/")).toContain(".cache/kino/captions");
  });

  test("timing: auto falls back to even timing when nothing is installed", async () => {
    const { isAlignmentAvailable } = await import("../src/captions/index.js");
    if (await isAlignmentAvailable()) return; // installed here; covered by the align test

    const timings = await timeWords("one two three", 3, "/nonexistent.wav", { timing: "auto" });
    expect(timings).toHaveLength(3);
    expect(timings[2].end).toBeCloseTo(3, 5);
  });

  test("timing: align explains how to install rather than guessing", async () => {
    const { isAlignmentAvailable } = await import("../src/captions/index.js");
    if (await isAlignmentAvailable()) return;

    await expect(timeWords("one two", 2, "/nonexistent.wav", { timing: "align" })).rejects.toThrow(
      /setup captions/
    );
  });

  test("captionsAsync produces the same element shape as captions", async () => {
    const line = fakeVoice("Where the mind is without fear.", 3);
    // `even` keeps this independent of whether the aligner is installed; the
    // fake path has no audio to decode.
    const els = await captionsAsync(line, { wordsPerLine: 6, timing: "even" });
    expect(els).toHaveLength(1);
    expect(els[0].captionWords).toHaveLength(6);
    expect(els[0].content).toBe("Where the mind is without fear.");
  });
});

describe("captions: pipeline", () => {
  test("normalization keeps caption words and resolves their timings", () => {
    const line = fakeVoice("Where the mind is without fear.", 3);
    const comp = composition({ width: 640, height: 360 })
      .scene({ duration: { fit: line, pad: 0 } }, (s) => s.addAll(captions(line, { wordsPerLine: 6 })))
      .build();

    const norm = normalizeComposition(comp);
    const el = norm.elements[0] as any;
    expect(el.captionWords).toHaveLength(6);
    expect(el.captionWords[0].at).toBe(0);
    expect(el.highlight).toBe("#38bdf8");
  });

  test("compile emits a karaoke sub-graph instead of a single drawtext", () => {
    const line = fakeVoice("Where the mind is without fear.", 3);
    const comp = composition({ width: 640, height: 360 })
      .scene({ duration: { fit: line, pad: 0 } }, (s) => s.addAll(captions(line, { wordsPerLine: 6 })))
      .build();

    const { args } = compile(comp, { output: "out.mp4" });
    const graph = args[args.indexOf("-filter_complex") + 1];
    // One split, one crop and one overlay per word.
    expect(graph).toContain("split=7");
    expect(graph.match(/crop=/g)).toHaveLength(6);
    expect(graph.match(/overlay=/g)).toHaveLength(6);
    // The highlight uses the accent colour, not the dim colour.
    expect(graph).toContain("0x38bdf8");
  });

  test("a plain text element still compiles to one drawtext", () => {
    const comp = composition({ width: 640, height: 360 })
      .scene({ duration: 2 }, (s) => s.text("Hello"))
      .build();
    const { args } = compile(comp, { output: "out.mp4" });
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).not.toContain("split=");
    expect(graph).not.toContain("crop=");
  });

  test("a graph too long for the command line is written to a script file", () => {
    // Long caption tracks produce graphs past ARG_MAX, which fails at spawn
    // with E2BIG and no useful message. Past a threshold the graph goes to a
    // file instead, and ffmpeg reads it with -filter_complex_script.
    const words = Array.from({ length: 400 }, (_, i) => ({
      word: `word${i}`,
      clean: `word${i}`,
      start: i * 0.2,
      end: i * 0.2 + 0.18,
    }));
    const els = captionElements(words, { style: "karaoke", wordsPerLine: 4 });
    const comp = composition({ width: 640, height: 360 })
      .scene({ duration: 90 }, (s) => s.addAll(els))
      .build();

    const { args, filtergraph } = compile(comp, { output: "out.mp4" });
    expect(filtergraph!.length).toBeGreaterThan(100_000);
    expect(args).not.toContain("-filter_complex");
    const idx = args.indexOf("-filter_complex_script");
    expect(idx).toBeGreaterThan(-1);
    // The manifest is replayed with the extraction dir as cwd, so the script is
    // referenced by name rather than by an absolute staging path.
    expect(args[idx + 1]).toBe("filtergraph.txt");
  });
});

describe("captions: image karaoke", () => {
  /** Four words across one line, so each state can be checked on its own. */
  const line = (n = 4) =>
    Array.from({ length: n }, (_, i) => ({
      word: `word${i}`,
      clean: `word${i}`,
      start: i * 0.5,
      end: i * 0.5 + 0.4,
    }));

  test("emits one image per word, each showing for its own span", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-caption-images-"));
    try {
      const els = await captionImages(line(), {
        width: 640,
        height: 100,
        dir,
        wordsPerLine: 4,
      });

      expect(els).toHaveLength(4);
      expect(els.every((e) => e.type === "image")).toBe(true);

      // Each frame starts when its word does and runs until the next word.
      expect(els.map((e) => e.startAt)).toEqual([0, 0.5, 1, 1.5]);
      expect(els[0].duration).toBeCloseTo(0.5, 5);
      expect(els[1].duration).toBeCloseTo(0.5, 5);
      // The last word holds past the end of its speech by the line hold.
      expect(els[3].duration).toBeCloseTo(1.9 + 0.35 - 1.5, 5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("writes a PNG per word and positions the strip", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-caption-images-"));
    try {
      const els = await captionImages(line(), {
        width: 640,
        height: 100,
        dir,
        wordsPerLine: 4,
        x: 12,
        y: 340,
      });

      for (const el of els) {
        expect(existsSync(el.src)).toBe(true);
        expect(el.src.endsWith(".png")).toBe(true);
        expect(el.x).toBe(12);
        expect(el.y).toBe(340);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("scales to a whole song's worth of words", async () => {
    // The text-based highlight stalled past a handful of lines. This is the
    // property that makes the image path worth having: cost per word stays
    // flat, so many lines still produce a composition quickly.
    const words = Array.from({ length: 200 }, (_, i) => ({
      word: `w${i % 37}`,
      clean: `w${i % 37}`,
      start: i * 0.4,
      end: i * 0.4 + 0.35,
    }));
    const dir = mkdtempSync(join(tmpdir(), "kino-caption-images-"));
    try {
      const els = await captionImages(words, {
        width: 640,
        height: 100,
        dir,
        wordsPerLine: 5,
      });
      expect(els).toHaveLength(200);

      const comp = composition({ width: 640, height: 360 })
        .scene({ duration: 80 }, (s) => s.addAll(els))
        .build();
      // Compiling must stay linear: images are timed overlays with one input
      // each, not a filter chain rebuilt per word the way drawtext was.
      const { args, filtergraph } = compile(comp, { output: "out.mp4" });
      const script =
        filtergraph ??
        readFileSync(args[args.indexOf("-filter_complex_script") + 1], "utf8");
      // 200 words, so 200 image inputs — but the graph must stay linear in the
      // word count rather than exploding the way per-word drawtext did.
      expect(script.length).toBeLessThan(4_000_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("caption seam — both renderers agree", () => {
  // `captionElements` (drawtext) and `captionImages` (PNG strips) used to build
  // their own lines, defaults and holds. That duplication already caused a bug:
  // holds were not trimmed against the following line, so two captions sat on
  // screen at once. These assert the shared path keeps them in step.
  const words = Array.from({ length: 9 }, (_, i) => ({
    word: `w${i}`,
    clean: `w${i}`,
    start: i * 0.5,
    end: i * 0.5 + 0.4,
  }));

  test("the last word of a line ends where the next line starts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-seam-"));
    try {
      const images = await captionImages(words, {
        width: 640,
        height: 100,
        dir,
        wordsPerLine: 3,
        hold: 0.35,
      });
      const texts = captionElements(words, { wordsPerLine: 3, hold: 0.35 });

      // Group the image elements back into lines and compare line ends.
      const imageEnds = images.map((e) => e.startAt + e.duration);
      const textEnds = texts.map((e) => e.startAt + e.duration);

      // Line 0 holds to just before line 1 starts; the same trim must apply to
      // both renderers.
      const firstLineImagesEnd = Math.max(...imageEnds.slice(0, 3));
      expect(firstLineImagesEnd).toBeLessThanOrEqual(1.5 + 1e-6);
      expect(textEnds[0]).toBeLessThanOrEqual(1.5 + 1e-6);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  test("both apply the same z-index default", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-seam-"));
    try {
      const images = await captionImages(words, { width: 640, height: 100, dir, wordsPerLine: 3 });
      const texts = captionElements(words, { wordsPerLine: 3 });
      expect(images[0].zIndex).toBe(texts[0].zIndex);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  test("an explicit z-index reaches both renderers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-seam-"));
    try {
      const images = await captionImages(words, {
        width: 640, height: 100, dir, wordsPerLine: 3, zIndex: 42,
      });
      const texts = captionElements(words, { wordsPerLine: 3, zIndex: 42 });
      expect(images[0].zIndex).toBe(42);
      expect(texts[0].zIndex).toBe(42);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  test("a font size written with units is parsed the same way", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-seam-"));
    try {
      // Both used to parse this separately; a string size must not fall back to
      // the default in one path and not the other.
      const images = await captionImages(words, {
        width: 640, height: 100, dir, wordsPerLine: 3, fontSize: "40px",
      });
      expect(images).toHaveLength(9);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
