import type { AudioTrack } from "./audio.js";
import type { ElementInput } from "./elements.js";
import type { BackgroundConfig } from "./background.js";
import type { KinoTransition } from "./composition.js";

export interface NormalizedScene {
  id: string;
  startTime: number;
  duration: number;
  background: BackgroundConfig;
  elements: ElementInput[];
  transition?: KinoTransition;
}

export interface NormalizedComposition {
  width: number;
  height: number;
  duration: number;
  fps: number;
  background: BackgroundConfig;
  elements: ElementInput[];
  scenes: NormalizedScene[];
  audio: AudioTrack[];
}
