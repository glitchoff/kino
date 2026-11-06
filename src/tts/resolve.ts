import type { KinoComposition } from "../types/composition.js";
import type { AudioTrack } from "../types/audio.js";
import { isTtsSpec, synthesizeToWav, type TtsSpec } from "./piper.js";

/** Synthesises one spec, memoised so repeated lines are only spoken once. */
async function synthesizeAll(specs: TtsSpec[]): Promise<Map<TtsSpec, string>> {
  const out = new Map<TtsSpec, string>();
  for (const spec of specs) {
    const existing = out.get(spec);
    if (existing) continue;
    out.set(spec, await synthesizeToWav(spec.text, spec.options));
  }
  return out;
}

/**
 * Replaces `tts()` sources — both `composition.audio` entries and scene-level
 * `s.say()` narration — with synthesised WAV paths.
 *
 * `compile()` is synchronous, so synthesis happens here first: `render()`
 * awaits this and then hands compile a composition that contains only real
 * files. Scene structure and timings are untouched.
 */
export async function resolveTtsTracks(comp: KinoComposition): Promise<KinoComposition> {
  const audio = comp.audio;
  const tracks: AudioTrack[] = audio ? (Array.isArray(audio) ? audio : [audio]) : [];

  const specs: TtsSpec[] = [];
  for (const track of tracks) {
    const src: unknown = (track as { src?: unknown }).src;
    if (isTtsSpec(src)) specs.push(src);
  }
  for (const scene of comp.scenes) {
    const narration = (scene as { narration?: unknown[] }).narration;
    if (Array.isArray(narration)) {
      for (const spec of narration) if (isTtsSpec(spec)) specs.push(spec);
    }
  }

  if (!specs.length) return comp;
  const wavs = await synthesizeAll(specs);

  const resolvedTracks: AudioTrack[] = tracks.map((track) => {
    const src: unknown = (track as { src?: unknown }).src;
    return isTtsSpec(src) ? { ...track, src: wavs.get(src)! } : track;
  });

  const resolvedScenes = comp.scenes.map((scene) => {
    const narration = (scene as { narration?: unknown[] }).narration;
    if (!Array.isArray(narration)) return scene;
    return {
      ...scene,
      narration: narration.map((spec) => (isTtsSpec(spec) ? wavs.get(spec)! : spec)),
    };
  });

  return {
    ...comp,
    scenes: resolvedScenes,
    ...(audio ? { audio: Array.isArray(audio) ? resolvedTracks : resolvedTracks[0] } : {}),
  };
}

/** True when any audio track or scene narration still needs synthesis. */
export function compositionHasTts(comp: KinoComposition): boolean {
  const audio = comp.audio;
  if (audio) {
    const tracks = Array.isArray(audio) ? audio : [audio];
    if (tracks.some((track) => isTtsSpec((track as { src?: unknown }).src))) return true;
  }
  // `s.say()` stores speech on the scene until normalization lifts it.
  return comp.scenes.some((scene) => {
    const narration = (scene as { narration?: unknown[] }).narration;
    return Array.isArray(narration) && narration.some(isTtsSpec);
  });
}

/**
 * Swaps `tts()` sources for a placeholder path so `--dry-run` can print an
 * inspectable command without downloading a voice or spawning piper.
 */
export function replaceTtsWithPlaceholders(comp: KinoComposition): KinoComposition {
  if (!compositionHasTts(comp)) return comp;
  const audio = comp.audio;
  const tracks: AudioTrack[] = audio ? (Array.isArray(audio) ? audio : [audio]) : [];
  const resolved = tracks.map((track) =>
    typeof track.src === "string" ? track : { ...track, src: "tts-pending.wav" }
  );
  const scenes = comp.scenes.map((scene) => {
    const narration = (scene as { narration?: unknown[] }).narration;
    if (!Array.isArray(narration)) return scene;
    return { ...scene, narration: narration.map(() => "tts-pending.wav") };
  });
  return {
    ...comp,
    scenes,
    ...(audio ? { audio: Array.isArray(audio) ? resolved : resolved[0] } : {}),
  };
}
