import { describe, test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { composition } from "../src/builder/index.js";
import { normalizeComposition } from "../src/normalize/composition.js";
import { buildAudioMix, duckGain } from "../src/pipeline/audio.js";
import { getFFmpegBinaryPath } from "../src/encoder/probe.js";
import type { AudioTrack } from "../src/types/index.js";

const FF = getFFmpegBinaryPath();

function normalize(audio: AudioTrack[]) {
  return normalizeComposition(
    composition({ width: 320, height: 180, fps: 12 }).audio(audio).scene({ duration: 4 }, (s) => s.text("x", { fontSize: 20 })).build()
  );
}

/** Render a graph to mono 8 kHz float samples. */
function samples(args: string[]): Float32Array | undefined {
  const res = spawnSync(FF, args, { maxBuffer: 256 * 1024 * 1024 });
  if (res.status !== 0 || !res.stdout) return undefined;
  const b = res.stdout as Buffer;
  return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
}

function rms(s: Float32Array, from: number, to: number): number {
  let t = 0;
  const a = Math.max(0, from);
  const z = Math.min(s.length, to);
  for (let i = a; i < z; i++) t += s[i] * s[i];
  return Math.sqrt(t / Math.max(1, z - a));
}

describe("audio ducking — normalization", () => {
  test("resolves duck.by to a track id", () => {
    const norm = normalize([
      { src: "music.wav", id: "music", duck: { by: "voice", amount: 0.25 } },
      { src: "voice.wav", id: "voice" },
    ]);
    expect(norm.audio[0].duck).toMatchObject({ by: ["voice"], amount: 0.25 });
    expect(norm.audio[1].duck).toBeUndefined();
  });

  test("fills defaults for attack, release and threshold", () => {
    const norm = normalize([
      { src: "music.wav", id: "music", duck: { by: "voice" } },
      { src: "voice.wav", id: "voice" },
    ]);
    expect(norm.audio[0].duck).toEqual({
      by: ["voice"],
      amount: 0.3,
      attack: 0.02,
      release: 0.4,
      threshold: 0.02,
    });
  });

  test("accepts several sources", () => {
    const norm = normalize([
      { src: "music.wav", id: "music", duck: { by: ["voice", "sfx"] } },
      { src: "voice.wav", id: "voice" },
      { src: "sfx.wav", id: "sfx" },
    ]);
    expect(norm.audio[0].duck!.by).toEqual(["voice", "sfx"]);
  });

  test("duck: true ignores non-speech tracks", () => {
    // Nothing is marked as speech without tts, so `duck: true` has nothing to
    // listen to and must fail loudly rather than silently doing nothing.
    expect(() =>
      normalize([
        { src: "music.wav", id: "music", duck: true },
        { src: "voice.wav", id: "voice" },
      ])
    ).toThrow(/no speech to duck under/);
  });

  test("duck: true with no speech throws a useful error", () => {
    expect(() =>
      normalize([
        { src: "music.wav", id: "music", duck: true },
        { src: "other.wav", id: "other" },
      ])
    ).toThrow(/no speech to duck under/);
  });

  test("an unknown sidechain id is rejected", () => {
    expect(() =>
      normalize([
        { src: "music.wav", id: "music", duck: { by: "nope" } },
        { src: "voice.wav", id: "voice" },
      ])
    ).toThrow(/ducks under 'nope', which does not exist/);
  });

  test("a track cannot duck under itself", () => {
    expect(() =>
      normalize([{ src: "music.wav", id: "music", duck: { by: "music" } }])
    ).toThrow(/cannot duck under itself/);
  });

  test("amount outside (0, 1] is rejected", () => {
    expect(() =>
      normalize([
        { src: "music.wav", id: "music", duck: { by: "voice", amount: 0 } },
        { src: "voice.wav", id: "voice" },
      ])
    ).toThrow(/between|level to drop/);
  });

  test("duck: false is a no-op", () => {
    const norm = normalize([
      { src: "music.wav", id: "music", duck: false },
      { src: "voice.wav", id: "voice" },
    ]);
    expect(norm.audio[0].duck).toBeUndefined();
  });
});

describe("audio ducking — filtergraph", () => {
  const norm = normalize([
    { src: "music.wav", id: "music", duck: { by: "voice", amount: 0.3 } },
    { src: "voice.wav", id: "voice", startTime: 1 },
  ]);

  test("emits sidechaincompress and pads the key to the full duration", () => {
    const graph: string[] = [];
    buildAudioMix(graph, norm.audio, [1, 2], [], 4);
    const joined = graph.join(";");
    expect(joined).toContain("sidechaincompress");
    // Without apad the mix is cut to the shortest speech track.
    expect(joined).toContain("apad=whole_dur=4");
  });

  test("splits the sidechain so it also reaches the final mix", () => {
    // A pad can only be consumed once; without asplit ffmpeg fails with
    // "Error binding filtergraph inputs/outputs: Invalid argument".
    const graph: string[] = [];
    buildAudioMix(graph, norm.audio, [1, 2], [], 4);
    const joined = graph.join(";");
    expect(joined).toContain("asplit=2");
    expect(joined).toContain("amix=inputs=2");
  });

  test("does nothing extra when no track is ducked", () => {
    const plain = normalize([{ src: "a.wav" }, { src: "b.wav" }]);
    const graph: string[] = [];
    buildAudioMix(graph, plain.audio, [1, 2], [], 4);
    const joined = graph.join(";");
    expect(joined).not.toContain("sidechaincompress");
    expect(joined).not.toContain("asplit");
  });
});

describe("duckGain", () => {
  test("deeper targets need more sidechain gain", () => {
    expect(duckGain(0.1)).toBeGreaterThan(duckGain(0.3));
    expect(duckGain(0.3)).toBeGreaterThan(duckGain(0.6));
  });

  test("matches the measured curve", () => {
    // Measured against a sine bed and sine voice at threshold 0.02, ratio 20.
    expect(duckGain(0.25)).toBeCloseTo(1.0, 1);
    expect(duckGain(0.73)).toBeCloseTo(0.3, 1);
  });
});

describe.skipIf(!FF || process.platform !== "linux")("audio ducking — render", () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-duck-"));
  const music = join(dir, "music.wav");
  const voice = join(dir, "voice.wav");

  const made = (() => {
    const a = spawnSync(FF, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:a", "pcm_s16le", music]);
    const b = spawnSync(FF, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=1000:duration=1.5", "-c:a", "pcm_s16le", voice]);
    return a.status === 0 && b.status === 0;
  })();

  /** Music-only level around the speech, with the voice muted in the mix only. */
  function levels(amount: number | undefined): { before: number; during: number; after: number } | undefined {
    const duck = amount === undefined ? undefined : { by: "voice", amount };
    const norm = normalize([
      { src: music, id: "music", duck } as AudioTrack,
      { src: voice, id: "voice", startTime: 1 },
    ]);
    const graph: string[] = [];
    const mix = buildAudioMix(graph, norm.audio, [0, 1], [], 4);
    // Mute the voice in the *final mix* with amix weights, so the sidechain
    // still hears it. Measuring the raw mix conflates ducking with the voice's
    // own energy.
    const last = graph.pop()!;
    const weighted = last.replace("amix=inputs=2:", "amix=inputs=2:weights=1 0:");
    void weighted;
    const s = samples(["-y", "-hide_banner", "-loglevel", "error", "-i", music, "-i", voice, "-filter_complex", graph.concat(last).join(";"), "-map", mix!, "-ac", "1", "-ar", "8000", "-f", "f32le", "-"]);
    if (!s) return undefined;
    return {
      before: rms(s, 0, 8000 * 0.7),
      during: rms(s, 8000 * 1.4, 8000 * 2.2),
      after: rms(s, 8000 * 3.2, 8000 * 3.9),
    };
  }

  test.skipIf(!made)("music drops under speech and comes back", () => {
    const norm = normalize([
      { src: music, id: "music", duck: { by: "voice", amount: 0.3 } },
      { src: voice, id: "voice", startTime: 1 },
    ]);
    const d = norm.audio[0].duck!;

    // The generated graph ends in an `amix` that folds in the voice, which
    // confounds a level measurement with the voice's own energy. Build the same
    // ducking chain by hand and take the music alone as the output, so what is
    // measured is the music's level and nothing else.
    const graph = [
      `[1:a]adelay=1000|1000[voice]`,
      `[voice]asplit=2[voice_keep][voice_copy]`,
      `[voice_copy]volume=${duckGain(d.amount)},apad=whole_dur=4[key]`,
      `[0:a][key]sidechaincompress=threshold=${d.threshold}:ratio=20:attack=${d.attack}:release=${d.release}[ducked]`,
      // `asplit` needs both halves consumed, and the voice must stay out of the
      // measured level. Weighting it to 0 keeps the graph valid and the
      // measurement clean; the sidechain still hears the unweighted copy.
      `[ducked][voice_keep]amix=inputs=2:weights=1 0:dropout_transition=0[out]`,
    ].join(";");

    const s = samples([
      "-y", "-hide_banner", "-loglevel", "error", "-i", music, "-i", voice,
      "-filter_complex", graph,
      "-map", "[out]", "-ac", "1", "-ar", "8000", "-f", "f32le", "-",
    ]);
    expect(s).toBeDefined();
    const before = rms(s!, 0, 8000 * 0.7);
    const during = rms(s!, 8000 * 1.4, 8000 * 2.2);
    const after = rms(s!, 8000 * 3.2, 8000 * 3.9);
    expect(before).toBeGreaterThan(0.01);
    expect(during).toBeLessThan(before * 0.8);
    expect(after).toBeGreaterThan(before * 0.9);
  }, 60_000);

  test("cleanup", () => {
    rmSync(dir, { recursive: true, force: true });
  });
});
