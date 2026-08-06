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
  duration: number;
}

export interface KinoScene {
  id?: string;
  duration: number;
  background?: BackgroundInput;
  elements?: ElementInput[];
  transition?: KinoTransition;
}

export interface KinoComposition {
  width?: number;
  height?: number;
  fps?: number;
  scenes: KinoScene[];
  audio?: AudioTrack | AudioTrack[];
  templates?: KinoTemplate[];
}
