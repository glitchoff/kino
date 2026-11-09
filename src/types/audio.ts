import type { TtsSpec } from "../tts/piper.js";

/**
 * Attenuates a track while another one is audible — music under narration.
 *
 * Uses `sidechaincompress`, so it follows the actual speech envelope and needs
 * no word timings. `attack` and `release` are the musical controls; a long
 * release is what stops it pumping between sentences.
 */
export interface DuckConfig {
  /**
   * Tracks that push this one down, by `id`. Omit to duck under every speech
   * track (anything from `tts()` or `s.say()`).
   */
  by?: string | string[];
  /**
   * How far to attenuate while the other track is audible. `0.3` means this
   * track drops *to* 30% of its volume, not by 30%. Default 0.3.
   */
  amount?: number;
  /** Seconds to ramp down when speech starts. Default 0.02. */
  attack?: number;
  /** Seconds to ramp back up after speech stops. Default 0.4. */
  release?: number;
  /** Sidechain level that counts as speech. Lower is more sensitive. Default 0.02. */
  threshold?: number;
}

export interface AudioTrack {
  /** A file path, URL, `yt:` source, or `tts()` spec. */
  src: string | TtsSpec;
  /** Names this track so another can duck under it. */
  id?: string;
  startTime?: number | string;
  offset?: number | string;
  duration?: number | string;
  volume?: number | string;
  loop?: boolean;
  fadeIn?: number | string;
  fadeOut?: number | string;
  /**
   * Drop this track under speech. `true` ducks under every speech track; an
   * object picks which tracks and how hard.
   */
  duck?: boolean | DuckConfig;
}
