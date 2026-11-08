import type { AudioTrack } from "./audio.js";
import type { ColorAdjust, ElementInput } from "./elements.js";
import type { BackgroundInput } from "./background.js";
import type { KinoTemplate } from "./template.js";

export type KinoTransitionType =
  | "fade"
  | "slideLeft"
  | "slideRight"
  | "slideUp"
  | "slideDown"
  | "wipeLeft"
  | "wipeRight"
  | "wipeUp"
  | "wipeDown"
  | "zoomIn"
  | "zoomOut";

export interface KinoTransition {
  type: KinoTransitionType;
  duration: number | string;
}

/** A scene sized to a measured line of speech. */
export interface NarrationFit {
  /** The `Voice` returned by `await voice(...)`. */
  fit: { readonly __kinoVoice: true; readonly seconds: number };
  /** Seconds added after the speech so the last word is not clipped. Default 0.6. */
  pad?: number;
  /** Seconds added before the speech. Default 0. */
  lead?: number;
  /** Shortest scene, whatever the speech length. */
  min?: number;
}

/** `duration` accepts a fixed length or a narration fit. */
export type SceneDuration = number | string | NarrationFit;

export interface KinoScene {
  id?: string;
  duration: SceneDuration;
  background?: BackgroundInput;
  elements?: ElementInput[];
  transition?: KinoTransition;
  /**
   * Speech declared for this scene (from `s.say(...)`). Lifted into
   * composition-level audio at the scene's start time during normalization.
   * Builder-only — not part of the JSON schema.
   */
  narration?: unknown[];
}

export interface KinoComposition {
  width?: number | string;
  height?: number | string;
  fps?: number | string;
  scenes: KinoScene[];
  audio?: AudioTrack | AudioTrack[];
  templates?: KinoTemplate[];
  /**
   * A grade applied once to the finished frame, after every scene and
   * transition. Use it for a look that should hold across the whole video;
   * per-element `grade` is for matching one clip to the rest.
   */
  grade?: ColorAdjust;
}