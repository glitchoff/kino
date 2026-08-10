import type { AudioTrack, NormalizedAudioTrack } from "../types/index.js";
import { parseDuration, parseVolume } from "./unit-parser.js";

export function normalizeAudio(audio?: AudioTrack | AudioTrack[]): NormalizedAudioTrack[] {
  if (!audio) return [];
  const tracks = Array.isArray(audio) ? audio : [audio];
  return tracks.map((track) => ({
    ...track,
    startTime: parseDuration(track.startTime) ?? 0,
    offset: parseDuration(track.offset),
    duration: parseDuration(track.duration),
    volume: parseVolume(track.volume),
    fadeIn: parseDuration(track.fadeIn),
    fadeOut: parseDuration(track.fadeOut),
  }));
}
