import { describe, test, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wavDuration, isVoice, isPiperAvailable, voice, type Voice } from "../src/tts/piper.js";
import { composition, SceneBuilder } from "../src/builder/index.js";
import { normalizeComposition, resolveSceneDuration, NARRATION_PAD } from "../src/normalize/index.js";
import { compile } from "../src/pipeline/index.js";

/** Minimal PCM WAV with `seconds` of silence at 22050 Hz, 16-bit mono. */
function wavFile(seconds: number, opts: { sampleRate?: number; channels?: number; bits?: number } = {}): string {
  const sampleRate = opts.sampleRate ?? 22050;
  const channels = opts.channels ?? 1;
  const bits = opts.bits ?? 16;
  const byteRate = (sampleRate * channels * bits) / 8;
  const dataSize = Math.round(byteRate * seconds);
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE((channels * bits) / 8, 32);
  buf.writeUInt16LE(bits, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);

  const file = join(mkdtempSync(join(tmpdir(), "kino-voice-")), "line.wav");
  writeFileSync(file, buf);
  return file;
}

/** A `Voice` shape without spawning Piper. */
function fakeVoice(seconds: number): Voice {
  return {
    __kinoVoice: true,
    text: "fake",
    options: {},
    path: "/tmp/fake.wav",
    seconds,
    spec: { __kinoTts: true, text: "fake", options: {} },
  };
}

describe("voice: WAV duration", () => {
  test("reads the length from the fmt/data chunks", () => {
    expect(wavDuration(wavFile(2.5))).toBeCloseTo(2.5, 3);
    expect(wavDuration(wavFile(0.25))).toBeCloseTo(0.25, 3);
  });

  test("honours byteRate for other sample formats", () => {
    expect(wavDuration(wavFile(1, { sampleRate: 44100, channels: 2, bits: 16 }))).toBeCloseTo(1, 3);
    expect(wavDuration(wavFile(1, { sampleRate: 16000, channels: 1, bits: 8 }))).toBeCloseTo(1, 3);
  });

  test("a truncated file reports the audio that is actually present", () => {
    const file = wavFile(2);
    const buf = readFileSync(file);
    // Keep the header and half the samples; the data size still claims 2s.
    const cut = join(mkdtempSync(join(tmpdir(), "kino-voice-")), "cut.wav");
    writeFileSync(cut, buf.subarray(0, 44 + Math.floor((buf.length - 44) / 2)));
    expect(wavDuration(cut)).toBeCloseTo(1, 1);
  });

  test("non-WAV input returns undefined instead of throwing", () => {
    const file = join(mkdtempSync(join(tmpdir(), "kino-voice-")), "noise.bin");
    writeFileSync(file, "definitely not a wav file, just some text that is long enough");
    expect(wavDuration(file)).toBeUndefined();
  });
});

describe("voice: fit", () => {
  test("speech plus the default tail", () => {
    expect(resolveSceneDuration({ fit: fakeVoice(3) })).toBeCloseTo(3 + NARRATION_PAD, 5);
    expect(NARRATION_PAD).toBe(0.6);
  });

  test("pad and lead are configurable", () => {
    expect(resolveSceneDuration({ fit: fakeVoice(3), pad: 1.2, lead: 0.4 })).toBeCloseTo(4.6, 5);
    expect(resolveSceneDuration({ fit: fakeVoice(3), pad: 0 })).toBe(3);
  });

  test("min keeps a short line on screen", () => {
    expect(resolveSceneDuration({ fit: fakeVoice(0.5), min: 2 })).toBe(2);
    expect(resolveSceneDuration({ fit: fakeVoice(5), min: 2 })).toBeCloseTo(5.6, 5);
  });

  test("fixed durations pass through untouched", () => {
    expect(resolveSceneDuration(5)).toBe(5);
    expect(resolveSceneDuration("0:05")).toBe("0:05");
  });

  test("an unmeasured voice is a clear error", () => {
    const unmeasured = { ...fakeVoice(0), seconds: Number.NaN };
    expect(() => resolveSceneDuration({ fit: unmeasured })).toThrow(/await voice/);
  });
});

describe("voice: scenes sized from narration", () => {
  test("normalization applies the fit to the scene and the timeline", () => {
    const a = fakeVoice(2);
    const b = fakeVoice(4);
    const comp = composition({ width: 640, height: 360 })
      .scene({ duration: { fit: a } }, (s) => s.say(a))
      .scene({ duration: { fit: b, pad: 1 } }, (s) => s.say(b))
      .build();

    const norm = normalizeComposition(comp);
    expect(norm.scenes[0].duration).toBeCloseTo(2.6, 5);
    expect(norm.scenes[1].duration).toBeCloseTo(5, 5);
    expect(norm.scenes[1].startTime).toBeCloseTo(2.6, 5);
    expect(norm.duration).toBeCloseTo(7.6, 5);
  });

  test("elements with no explicit duration fill the fitted scene", () => {
    const v = fakeVoice(3);
    const comp = composition({ width: 640, height: 360 })
      .scene({ duration: { fit: v } }, (s) => s.text("hi").say(v))
      .build();

    const norm = normalizeComposition(comp);
    expect(norm.elements[0].duration).toBeCloseTo(3.6, 5);
  });

  test("fit accounts for transition overlap like any other duration", () => {
    const a = fakeVoice(2);
    const b = fakeVoice(2);
    const comp = composition({ width: 640, height: 360 })
      .scene({ duration: { fit: a, pad: 0 } }, (s) => s.say(a))
      .scene({ duration: { fit: b, pad: 0 }, transition: { type: "fade", duration: 0.5 } }, (s) => s.say(b))
      .build();

    const norm = normalizeComposition(comp);
    expect(norm.scenes[1].startTime).toBeCloseTo(1.5, 5);
    // Narration starts with its scene, so the voice is not pushed late.
    expect(norm.audio[1].startTime).toBeCloseTo(1.5, 5);
  });

  test("a Voice passed to say() reuses the measured spec", () => {
    const v = fakeVoice(2);
    const scene = new SceneBuilder({ duration: { fit: v } }).say(v).build();
    expect(scene.narration).toEqual([v.spec]);
  });

  test("an unresolved fit never reaches the compiler", () => {
    const comp = composition({ width: 640, height: 360 })
      .scene({ duration: { fit: fakeVoice(1) } }, (s) => s.text("hi"))
      .build();
    // Normalization resolves it, so compiling succeeds with a numeric duration.
    const norm = normalizeComposition(comp);
    expect(typeof norm.scenes[0].duration).toBe("number");
  });
});

describe("voice: real synthesis", () => {
  // Piper is optional, like ffmpeg. Skip rather than fail when it is absent.
  const available = isPiperAvailable();

  test.skipIf(!available)("measures a real line and caches it", async () => {
    const first = await voice("Kino measures its own speech.", { voice: "en_US-lessac-medium" });
    expect(isVoice(first)).toBe(true);
    expect(first.seconds).toBeGreaterThan(0.5);
    expect(first.seconds).toBeLessThan(10);

    // Same text, same voice, same rate: the cache is hit, not a second spawn.
    const started = Date.now();
    const second = await voice("Kino measures its own speech.", { voice: "en_US-lessac-medium" });
    expect(second.path).toBe(first.path);
    expect(second.seconds).toBeCloseTo(first.seconds, 5);
    expect(Date.now() - started).toBeLessThan(2000);
  }, 120_000);
});

describe("voice: compile", () => {
  test("a fitted scene compiles to a numeric -t", () => {
    const v = fakeVoice(2);
    const comp = composition({ width: 320, height: 180, fps: 10 })
      .scene({ duration: { fit: v, pad: 0 } }, (s) => s.text("hi"))
      .build();

    const { args } = compile(comp, { output: "out.mp4" });
    const i = args.indexOf("-t");
    expect(Number(args[i + 1])).toBeCloseTo(2, 5);
  });
});
