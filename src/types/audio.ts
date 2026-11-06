import type { TtsSpec } from "../tts/piper.js";

export interface AudioTrack {
  /** A file path, URL, `yt:` source, or `tts()` spec. */
  src: string | TtsSpec;
  startTime?: number | string;
  offset?: number | string;
  duration?: number | string;
  volume?: number | string;
  loop?: boolean;
  fadeIn?: number | string;
  fadeOut?: number | string;
}
