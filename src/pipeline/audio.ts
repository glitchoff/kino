import type { NormalizedAudioTrack } from "../types/index.js";
import { parseDuration, parseVolume } from "../normalize/unit-parser.js";

export function buildAudioMix(
  filterComplex: string[],
  audioTracks: NormalizedAudioTrack[],
  audioInputIndices: number[],
  videoElemAudioPads: string[],
  totalDuration: number
): string | undefined {
  const audioFilterPads: string[] = [];

  for (let i = 0; i < audioTracks.length; i++) {
    const track = audioTracks[i];
    const aIdx = audioInputIndices[i];
    const outPad = `[a_track_${i}]`;
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

    if (afs.length > 0) {
      filterComplex.push(`[${aIdx}:a]${afs.join(",")}${outPad}`);
      audioFilterPads.push(outPad);
    } else {
      audioFilterPads.push(`[${aIdx}:a]`);
    }
  }

  // Fold video-element audio (opt-in) into the master mix alongside track audio.
  if (videoElemAudioPads.length > 0) {
    audioFilterPads.push(...videoElemAudioPads);
  }

  if (audioFilterPads.length === 0) return undefined;
  if (audioFilterPads.length === 1) return audioFilterPads[0];

  const amixInput = audioFilterPads.join("");
  filterComplex.push(
    `${amixInput}amix=inputs=${audioFilterPads.length}:dropout_transition=0[a_mix_final]`
  );
  return "[a_mix_final]";
}
