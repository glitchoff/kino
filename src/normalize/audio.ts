import type { AudioTrack, NormalizedAudioTrack } from "../types/index.js";
import { isTtsSpec } from "../tts/piper.js";
import { parseDuration, parseVolume } from "./unit-parser.js";

export function normalizeAudio(audio?: AudioTrack | AudioTrack[]): NormalizedAudioTrack[] {
  if (!audio) return [];
  const tracks = Array.isArray(audio) ? audio : [audio];
  return tracks.map((track) => ({
    ...track,
    // A TtsSpec here means synthesis was skipped; fail loudly instead of
    // handing FFmpeg an object.
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
    fadeIn: parseDuration(track.fadeIn),
    fadeOut: parseDuration(track.fadeOut),
  }));
}
