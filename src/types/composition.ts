import type { AudioTrack } from "./audio.js";
import type { ElementInput } from "./elements.js";
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

export interface KinoScene {
  id?: string;
  duration: number | string;
  background?: BackgroundInput;
  elements?: ElementInput[];
  transition?: KinoTransition;
}

export interface KinoComposition {
  width?: number | string;
  height?: number | string;
  fps?: number | string;
  scenes: KinoScene[];
  audio?: AudioTrack | AudioTrack[];
  templates?: KinoTemplate[];
}
