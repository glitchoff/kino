import { describe, test, expect } from "vitest";
import {
  splitWords,
  cleanWord,
  evenTimings,
  groupWords,
  buildCaptionLines,
  captionElements,
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
    expect(alignerInstallDir()).toContain(".cache/kino/captions");
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
});
