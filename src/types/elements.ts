import type { AudioTrack } from "./audio.js";
import type { ElementAnimation } from "./animation.js";

export interface BaseElement {
  id?: string;
  x?: number | string;
  y?: number | string;
  offsetX?: number | string;
  offsetY?: number | string;
  startAt?: number | string;
  startTime?: number; // Internal normalized absolute composition start time
  duration?: number | string;
  sfx?: string | AudioTrack;
  zIndex?: number | string;
  animation?: ElementAnimation;
}

export interface TextElement extends BaseElement {
  type?: "text";
  content: string;
  fontSize?: number | string;
  fontColor?: string;
  fontFile?: string;
  box?: boolean;
  boxColor?: string;
  boxPadding?: number | string;
  maxWidth?: number | string;
  textAlign?: "left" | "center" | "right";
  lineHeight?: number | string;
  stroke?: {
    color: string;
    width: number | string;
  };
  shadow?: {
    color: string;
    x?: number | string;
    y?: number | string;
  };
}

export type MediaFit = "contain" | "cover" | "fill" | "none";

// Backward compatible alias
export type ObjectFit = MediaFit;

export interface ImageElement extends BaseElement {
  type: "image";
  src: string;
  width?: number | string;
  height?: number | string;
  fit?: MediaFit;
}

export interface HtmlElement extends BaseElement {
  type: "html";
  html: string;
  css?: string;
  width: number | string;
  height: number | string;
  fit?: MediaFit;
  backgroundColor?: string;
  deviceScaleFactor?: number | string;
}

export interface VideoElement extends BaseElement {
  type: "video";
  src: string;

  // Layout
  width?: number | string;
  height?: number | string;
  fit?: MediaFit;

  // Source playback
  trimStart?: number | string;
  loop?: boolean;
  volume?: number | string;
}

export type ElementInput = TextElement | ImageElement | HtmlElement | VideoElement;

// Backward compatible alias
export type TextOverlay = TextElement;
