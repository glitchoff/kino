import type { AudioTrack } from "../types/index.js";

export function buildAudioMix(
  filterComplex: string[],
  audioTracks: AudioTrack[],
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

    if (track.offset || track.duration) {
      const trimStart = track.offset ?? 0;
      const trimEnd = track.duration !== undefined ? trimStart + track.duration : totalDuration;
      afs.push(`atrim=${trimStart}:${trimEnd}`, `asetpts=PTS-STARTPTS`);
    }
    if (track.volume !== undefined && track.volume !== 1.0) {
      afs.push(`volume=${track.volume}`);
    }
    if (track.fadeIn) {
      afs.push(`afade=t=in:ss=0:d=${track.fadeIn}`);
    }
    if (track.fadeOut) {
      const clipLen = track.duration ?? totalDuration;
      const fadeStart = Math.max(0, clipLen - track.fadeOut);
      afs.push(`afade=t=out:st=${fadeStart}:d=${track.fadeOut}`);
    }
    if (track.startTime) {
      const delayMs = Math.round(track.startTime * 1000);
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
