import type { NormalizedAudioTrack } from "../types/index.js";
import { parseDuration, parseVolume } from "../normalize/unit-parser.js";

/**
 * Build the per-track audio filters and the final mix.
 *
 * Ducking shapes this: `sidechaincompress` consumes two streams and produces
 * one, so a ducked track cannot be filtered until its sidechain exists. The
 * flat loop became an ordered pass — each track waits for the tracks it listens
 * to.
 *
 * Two things about `sidechaincompress` that cost time to find:
 *
 * - It ends when the **sidechain** ends, not the main input. A 1.5s voice track
 *   truncates a 4s music bed, so the sidechain is padded to the full duration.
 * - It attenuates by a level ratio, not to a target. Depth is driven by the
 *   sidechain's own gain: scaling the key up compresses harder. Measured at
 *   threshold 0.02, ratio 20: sidechain ×0.3 ducks to ~72%, ×1.0 to ~25%,
 *   ×3.0 to ~9%. That is the knob `amount` turns.
 */
export function buildAudioMix(
  filterComplex: string[],
  audioTracks: NormalizedAudioTrack[],
  audioInputIndices: number[],
  videoElemAudioPads: string[],
  totalDuration: number
): string | undefined {
  const done = new Set<number>();
  const byId = new Map<string, number>();
  /**
   * Pads that were `asplit` for a sidechain. The original pad is consumed by
   * the split, so the final mix uses the kept half instead.
   */
  const keepPad = new Map<number, string>();
  audioTracks.forEach((t, i) => {
    if (t.id) byId.set(t.id, i);
  });

  const padFor = (i: number) => keepPad.get(i) ?? `[a_track_${i}]`;

  /** Trim, volume, fades and the delay that positions the track. */
  const buildChain = (track: NormalizedAudioTrack): string[] => {
    const afs: string[] = [];
    const offset = parseDuration(track.offset) ?? 0;
    const duration = parseDuration(track.duration);
    const volume = parseVolume(track.volume);
    const fadeIn = parseDuration(track.fadeIn);
    const fadeOut = parseDuration(track.fadeOut);
    const startTime = parseDuration(track.startTime) ?? 0;

    if (offset || duration) {
      const trimStart = offset;
      const trimEnd = duration !== undefined ? trimStart + duration : totalDuration;
      afs.push(`atrim=${trimStart}:${trimEnd}`, `asetpts=PTS-STARTPTS`);
    }
    if (volume !== undefined && volume !== 1.0) {
      afs.push(`volume=${volume}`);
    }
    if (fadeIn) {
      afs.push(`afade=t=in:ss=0:d=${fadeIn}`);
    }
    if (fadeOut) {
      const clipLen = duration ?? totalDuration;
      const fadeStart = Math.max(0, clipLen - fadeOut);
      afs.push(`afade=t=out:st=${fadeStart}:d=${fadeOut}`);
    }
    if (startTime) {
      const delayMs = Math.round(startTime * 1000);
      afs.push(`adelay=${delayMs}|${delayMs}`);
    }
    return afs;
  };

  /** Emit a track's chain once, returning its pad. */
  const prepare = (i: number): string => {
    if (done.has(i)) return padFor(i);
    const track = audioTracks[i];
    const aIdx = audioInputIndices[i];
    const afs = buildChain(track);
    const outPad = `[a_track_${i}]`;
    filterComplex.push(`[${aIdx}:a]${afs.length > 0 ? afs.join(",") : "anull"}${outPad}`);
    done.add(i);
    return outPad;
  };

  // Plain tracks first: they are cheap and they are what ducking listens to.
  for (let i = 0; i < audioTracks.length; i++) {
    if (!audioTracks[i].duck) prepare(i);
  }

  // Then ducked tracks, after their sidechains exist.
  for (let i = 0; i < audioTracks.length; i++) {
    const track = audioTracks[i];
    if (!track.duck) continue;

    const main = prepare(i);
    const sideIndices = track.duck.by.map((id) => byId.get(id)!).filter((n) => n !== undefined);
    for (const s of sideIndices) prepare(s);

    // A pad can only be consumed once and sidechain tracks also feed the final
    // mix, so split each: the compressor gets a copy, the mix keeps the rest.
    const copies: string[] = [];
    for (const s of sideIndices) {
      const copy = `[a_side_copy_${i}_${s}]`;
      filterComplex.push(`${padFor(s)}asplit=2[a_side_keep_${i}_${s}]${copy}`);
      keepPad.set(s, `[a_side_keep_${i}_${s}]`);
      copies.push(copy);
    }

    const d = track.duck;
    // Pad every sidechain to the full duration, or the mix is cut to the
    // shortest speech track.
    const gain = duckGain(d.amount);
    const keyed = copies.map((c, n) => {
      const out = `[a_key_${i}_${n}]`;
      filterComplex.push(`${c}volume=${gain},apad=whole_dur=${totalDuration}${out}`);
      return out;
    });

    let side: string;
    if (keyed.length === 1) {
      side = keyed[0];
    } else {
      filterComplex.push(
        `${keyed.join("")}amix=inputs=${keyed.length}:dropout_transition=0[a_side_${i}]`
      );
      side = `[a_side_${i}]`;
    }

    filterComplex.push(
      `${main}${side}sidechaincompress=threshold=${d.threshold}:ratio=20:` +
        `attack=${d.attack}:release=${d.release}[a_track_${i}]`
    );
  }

  const audioFilterPads: string[] = audioTracks.map((_, i) => padFor(i));
  if (videoElemAudioPads.length > 0) {
    audioFilterPads.push(...videoElemAudioPads);
  }

  if (audioFilterPads.length === 0) return undefined;
  if (audioFilterPads.length === 1) return audioFilterPads[0];

  filterComplex.push(
    `${audioFilterPads.join("")}amix=inputs=${audioFilterPads.length}:dropout_transition=0[a_mix_final]`
  );
  return "[a_mix_final]";
}

/**
 * Sidechain gain that produces a given duck depth.
 *
 * `amount` is the level to drop *to* (0.3 = down to 30%). `sidechaincompress`
 * attenuates by a ratio, not to a target, so depth is driven by how hard the
 * key hits the threshold.
 *
 * Measured against a sine bed with a sine voice at threshold 0.02 / ratio 20,
 * gain 0.3 → 73%, 0.6 → 41%, 1.0 → 25%, 2.0 → 13%, 4.0 → 7%, 8.0 → 3.5%. That
 * is a clean power law, `fraction = 0.248 · gain^-0.931` (fitted, max error
 * 0.03), so inverting it gives the gain directly.
 *
 * The exact figure depends on programme material — this is a target, not a
 * guarantee. It is monotonic and close, which is what matters for music under
 * narration.
 */
export function duckGain(amount: number): number {
  const target = Math.min(0.95, Math.max(0.02, amount));
  const SLOPE = -0.931;
  const INTERCEPT = -1.3961;
  // ln(f) = SLOPE * ln(g) + INTERCEPT  →  g = exp((ln(f) - INTERCEPT) / SLOPE)
  const gain = Math.exp((Math.log(target) - INTERCEPT) / SLOPE);
  return Math.max(0.05, Math.min(20, Number(gain.toFixed(4))));
}
