import type { AudioTrack } from "./audio.js";
import type { ElementAnimation } from "./animation.js";

export interface BaseElement {
  id?: string;
  x?: number | string;
  y?: number | string;
  offsetX?: number;
  offsetY?: number;
  startAt?: number;
  startTime?: number; // Internal normalized absolute composition start time
  duration?: number;
  sfx?: string | AudioTrack;
  zIndex?: number;
  animation?: ElementAnimation;
}

export interface TextElement extends BaseElement {
  type?: "text";
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

export type MediaFit = "contain" | "cover" | "fill" | "none";

// Backward compatible alias
export type ObjectFit = MediaFit;

export interface ImageElement extends BaseElement {
  type: "image";
  src: string;
  width?: number;
  height?: number;
  fit?: MediaFit;
}

export interface HtmlElement extends BaseElement {
  type: "html";
  html: string;
  css?: string;
  width: number;
  height: number;
  fit?: MediaFit;
  backgroundColor?: string;
  deviceScaleFactor?: number;
}

export interface VideoElement extends BaseElement {
  type: "video";
  src: string;

  // Layout
  width?: number;
  height?: number;
  fit?: MediaFit;

  // Source playback
  trimStart?: number;
  loop?: boolean;
  volume?: number;
}

export type ElementInput = TextElement | ImageElement | HtmlElement | VideoElement;

// Backward compatible alias
export type TextOverlay = TextElement;
