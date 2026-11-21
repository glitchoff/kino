import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * A whole-clip audio waveform, held in memory.
 *
 * ## Why this is not the frame cache
 *
 * Video frames are megabytes each, so they need a budget and (eventually) a
 * sliding window. Audio is not like that: one second of 24 kHz mono 16-bit is
 * 48 KB, so a 266 s clip is ~13 MB *as raw samples* and a few hundred bytes as
 * a downsampled envelope. The entire waveform fits regardless of clip length,
 * so there is nothing to evict and no window to slide.
 *
 * ## What it produces
 *
 * `levels` is one peak per bucket, normalised to 0..1, in time order. That is
 * enough to draw a waveform or a bar strip and to answer "is there speech
 * here?", which is what a timeline needs. It is deliberately not a full
 * sample-accurate envelope: the client has a few hundred pixels, not 6 million.
 */
export interface AudioLevels {
  /** Peak per bucket, 0..1, in time order. */
  levels: number[];
  /** Seconds covered by the clip. */
  duration: number;
  /** Seconds per bucket. */
  bucket: number;
  /** True when no track produced any signal. */
  silent: boolean;
}

export interface AudioTrackLike {
  src: string;
  startTime?: number;
  duration?: number;
  offset?: number;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
}

/** Sample rate used for decoding. Low is fine for a peak envelope. */
const RATE = 8000;

/**
 * Decode every track, mix them, and reduce to `buckets` peaks.
 *
 * Tracks are mixed additively with their own start offset and volume, because a
 * timeline that showed each track separately would be a multi-lane editor, and
 * this is one lane. A track that cannot be decoded is skipped rather than
 * failing the whole waveform — a missing SFX should not blank the timeline.
 */
export async function buildAudioLevels(
  ffmpeg: string,
  tracks: AudioTrackLike[],
  duration: number,
  buckets = 600
): Promise<AudioLevels> {
  const empty: AudioLevels = {
    levels: new Array(buckets).fill(0),
    duration,
    bucket: duration / buckets,
    silent: true,
  };
  if (!tracks.length || duration <= 0) return empty;

  const total = Math.max(1, Math.round(duration * RATE));
  // Float32 mix buffer: additive, so overlapping tracks sum.
  const mix = new Float32Array(total);

  let decodedAny = false;
  for (const track of tracks) {
    if (!track.src || !existsSync(track.src)) continue;
    try {
      const samples = await decodeMono(ffmpeg, track.src);
      if (!samples.length) continue;
      decodedAny = true;

      const start = Math.max(0, Math.round((track.startTime ?? 0) * RATE));
      const skip = Math.max(0, Math.round((track.offset ?? 0) * RATE));
      const gain = track.volume ?? 1;
      const limit = track.duration
        ? Math.round(track.duration * RATE)
        : samples.length - skip;

      for (let i = 0; i < limit; i++) {
        const si = skip + i;
        if (si >= samples.length) break;
        const di = start + i;
        if (di >= total) break;
        mix[di] += samples[si] * gain;
      }
    } catch {
      // A broken track must not take the waveform with it.
    }
  }

  if (!decodedAny) return empty;

  const perBucket = total / buckets;
  const levels: number[] = [];
  let peakAll = 0;
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * perBucket);
    const to = Math.min(total, Math.floor((b + 1) * perBucket));
    let peak = 0;
    for (let i = from; i < to; i++) {
      const v = Math.abs(mix[i]);
      if (v > peak) peak = v;
    }
    levels.push(peak);
    if (peak > peakAll) peakAll = peak;
  }

  // Normalise to the loudest bucket so the strip fills its height whatever the
  // recording level. Silence stays zero rather than dividing by zero.
  if (peakAll > 1e-6) {
    for (let i = 0; i < levels.length; i++) levels[i] = levels[i] / peakAll;
  }

  return {
    levels,
    duration,
    bucket: duration / buckets,
    silent: peakAll <= 1e-6,
  };
}

/** Decode a file to mono float samples at `RATE`. */
function decodeMono(ffmpeg: string, file: string): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpeg,
      [
        "-hide_banner", "-loglevel", "error",
        "-i", file,
        "-ac", "1", "-ar", String(RATE),
        "-f", "f32le", "-",
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c) => {
      if (stderr.length < 2000) stderr += c;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && chunks.length === 0) {
        reject(new Error(`audio decode failed: ${stderr.trim()}`));
        return;
      }
      const buf = Buffer.concat(chunks);
      // f32le: 4 bytes per sample.
      const n = Math.floor(buf.length / 4);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = buf.readFloatLE(i * 4);
      resolve(out);
    });
  });
}
