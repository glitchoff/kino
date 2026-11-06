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
  src: string;
  startTime: number;
  offset?: number;
  duration?: number;
  volume?: number;
  loop?: boolean;
  fadeIn?: number;
  fadeOut?: number;
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
}

export interface NormalizedTextElement extends NormalizedBaseElement {
  type: "text";
  content: string;
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
  loop?: boolean;
  volume?: number;
  chromaKey?: ChromaKey;
}

export type NormalizedElement =
  | NormalizedTextElement
  | NormalizedImageElement
  | NormalizedHtmlElement
  | NormalizedVideoElement;

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
