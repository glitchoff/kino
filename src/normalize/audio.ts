import type { AudioTrack, NormalizedAudioTrack } from "../types/index.js";
import { isTtsSpec } from "../tts/piper.js";
import { parseDuration, parseVolume } from "./unit-parser.js";

const DEFAULT_DUCK = { amount: 0.3, attack: 0.02, release: 0.4, threshold: 0.02 };

/** Strip `duck` from a track: it is resolved later, once every id is known. */
function normalizeOne(track: AudioTrack): NormalizedAudioTrack {
  const out: NormalizedAudioTrack = {
    src:
      typeof track.src === "string"
        ? track.src
        : (() => {
            if (isTtsSpec(track.src)) {
              throw new Error(
                "tts() audio reached the compiler unresolved. Render through render() so speech is synthesised first."
              );
            }
            return track.src as unknown as string;
          })(),
    startTime: parseDuration(track.startTime) ?? 0,
    offset: parseDuration(track.offset),
    duration: parseDuration(track.duration),
    volume: parseVolume(track.volume),
    loop: track.loop,
    fadeIn: parseDuration(track.fadeIn),
    fadeOut: parseDuration(track.fadeOut),
  };
  if (track.id !== undefined) out.id = track.id;
  return out;
}

/**
 * Normalize the composition's declared audio tracks.
 *
 * Does not resolve `duck` — narration and sfx tracks are appended later in
 * `normalizeComposition`, so ducking runs over the finished list. See
 * `resolveDucking`.
 */
export function normalizeAudio(audio?: AudioTrack | AudioTrack[]): NormalizedAudioTrack[] {
  if (!audio) return [];
  const tracks = Array.isArray(audio) ? audio : [audio];
  return tracks.map(normalizeOne);
}

/**
 * Resolve every `duck` entry against the finished track list.
 *
 * `declared` is the raw input, needed because the resolved tracks no longer
 * carry the author's `duck: true | DuckConfig`. Tracks appended later (narration,
 * sfx) have no `duck` and are skipped.
 */
export function resolveDucking(
  tracks: NormalizedAudioTrack[],
  declared?: AudioTrack | AudioTrack[]
): NormalizedAudioTrack[] {
  if (!declared) return tracks;
  const raw = Array.isArray(declared) ? declared : [declared];

  const byId = new Map<string, NormalizedAudioTrack>();
  for (const t of tracks) {
    if (t.id) byId.set(t.id, t);
  }

  raw.forEach((track, i) => {
    if (track.duck === undefined || track.duck === false) return;
    const target = tracks[i];
    if (!target) return;

    const config = track.duck === true ? {} : track.duck;
    const by =
      config.by === undefined ? undefined : Array.isArray(config.by) ? config.by : [config.by];

    let sources: string[];
    if (by) {
      sources = by;
    } else {
      // Duck under every speech track except itself.
      sources = tracks
        .filter((t) => t.speech && t !== target && t.id !== undefined)
        .map((t) => t.id!);
      if (sources.length === 0) {
        throw new Error(
          `Audio track${target.id ? ` '${target.id}'` : ` #${i}`} has duck: true but there is no speech to duck under. ` +
            `Add a tts()/s.say() track, or name one with duck: { by: "..." }.`
        );
      }
    }

    if (target.id !== undefined && sources.includes(target.id)) {
      throw new Error(`Audio track '${target.id}' cannot duck under itself.`);
    }
    for (const source of sources) {
      if (!byId.has(source)) {
        const known = [...byId.keys()];
        throw new Error(
          `Audio track${target.id ? ` '${target.id}'` : ` #${i}`} ducks under '${source}', which does not exist. ` +
            (known.length ? `Known ids: ${known.join(", ")}.` : "No track has an id.")
        );
      }
    }

    const amount = config.amount ?? DEFAULT_DUCK.amount;
    if (!(amount > 0 && amount <= 1)) {
      throw new Error(
        `Audio duck amount is the level to drop *to*, so it must be in (0, 1]. Got ${config.amount}.`
      );
    }

    target.duck = {
      by: sources,
      amount,
      attack: config.attack ?? DEFAULT_DUCK.attack,
      release: config.release ?? DEFAULT_DUCK.release,
      threshold: config.threshold ?? DEFAULT_DUCK.threshold,
    };
  });

  return tracks;
}
