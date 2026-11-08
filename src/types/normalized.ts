import type { MediaFit } from "./elements.js";
import type { ChromaKey } from "../pipeline/elements/media.js";
import type { BackgroundConfig } from "./background.js";
import type { Easing } from "./animation.js";

export interface NormalizedAnimationValue {
  from: number;
  to: number;
  duration: number;
  delay?: number;
  easing?: Easing;
}

export interface NormalizedElementAnimation {
  opacity?: NormalizedAnimationValue;
  x?: NormalizedAnimationValue;
  y?: NormalizedAnimationValue;
  scale?: NormalizedAnimationValue;
}

export interface NormalizedAudioTrack {
  /** Always a real file path or URL: `tts()` specs are resolved before compile. */
  src: string;
  /** Names this track so another can duck under it. */
  id?: string;
  startTime: number;
  offset?: number;
  duration?: number;
  volume?: number;
  loop?: boolean;
  fadeIn?: number;
  fadeOut?: number;
  /** Resolved ducking config; `undefined` when the track is not ducked. */
  duck?: {
    by: string[];
    amount: number;
    attack: number;
    release: number;
    threshold: number;
  };
  /**
   * True when this track is speech — a `tts()` track or `s.say()`. Set during
   * normalization so `duck: true` knows what to listen to.
   */
  speech?: boolean;
}

export interface NormalizedBaseElement {
  id?: string;
  x?: number | string;
  y?: number | string;
  offsetX?: number;
  offsetY?: number;
  startAt: number;
  startTime: number;
  duration?: number;
  sfx?: string | NormalizedAudioTrack;
  zIndex?: number;
  animation?: NormalizedElementAnimation;
  /** Per-element brightness/contrast/saturation/hue/gamma/lift/gain. */
  grade?: import("./elements.js").ColorAdjust;
}

export interface NormalizedCaptionWord {
  word: string;
  at: number;
  duration: number;
}

export interface NormalizedTextElement extends NormalizedBaseElement {
  type: "text";
  content: string;
  /** Per-word karaoke timings, relative to `startAt`. */
  captionWords?: NormalizedCaptionWord[];
  /** Colour of the word being spoken. */
  highlight?: string;
  fontSize?: number;
  fontColor?: string;
  fontFile?: string;
  box?: boolean;
  boxColor?: string;
  boxPadding?: number;
  maxWidth?: number;
  textAlign?: "left" | "center" | "right";
  lineHeight?: number;
  stroke?: {
    color: string;
    width: number;
  };
  shadow?: {
    color: string;
    x?: number;
    y?: number;
  };
}

export interface NormalizedImageElement extends NormalizedBaseElement {
  type: "image";
  src: string;
  width?: number;
  height?: number;
  fit?: MediaFit;
  chromaKey?: ChromaKey;
}

export interface NormalizedHtmlElement extends NormalizedBaseElement {
  type: "html";
  html: string;
  css?: string;
  width: number;
  height: number;
  fit?: MediaFit;
  backgroundColor?: string;
  deviceScaleFactor?: number;
}

export interface NormalizedVideoElement extends NormalizedBaseElement {
  type: "video";
  src: string;
  width?: number;
  height?: number;
  fit?: MediaFit;
  trimStart?: number;
  trimEnd?: number;
  loop?: boolean;
  volume?: number;
  chromaKey?: ChromaKey;
}

/**
 * A shape. `src` is filled in at compile time with the rasterised PNG, at which
 * point the element is overlaid exactly like an image.
 */
export interface NormalizedShapeElement extends NormalizedBaseElement {
  type: "shape";
  shape: "rect" | "ellipse" | "line";
  width: number;
  height: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  /** Set by the compiler once the PNG exists. */
  src?: string;
}

export type NormalizedElement =
  | NormalizedTextElement
  | NormalizedImageElement
  | NormalizedHtmlElement
  | NormalizedVideoElement
  | NormalizedShapeElement;

export interface NormalizedTransition {
  type: string;
  duration: number;
}

export interface NormalizedScene {
  id: string;
  startTime: number;
  duration: number;
  background: BackgroundConfig;
  elements: NormalizedElement[];
  transition?: NormalizedTransition;
}

export interface NormalizedComposition {
  width: number;
  height: number;
  duration: number;
  fps: number;
  background: BackgroundConfig;
  elements: NormalizedElement[];
  scenes: NormalizedScene[];
  audio: NormalizedAudioTrack[];
}
