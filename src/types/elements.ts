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

/** One word inside a caption line, timed relative to the element's start. */
export interface CaptionWord {
  /** The word as written. */
  word: string;
  /** Seconds from the element's `startAt` until the word begins. */
  at: number;
  /** Seconds the word is spoken. */
  duration: number;
}

export interface TextElement extends BaseElement {
  type?: "text";
  content: string;
  /**
   * Caption words. When set, the pipeline draws `content` once in `fontColor`
   * and then re-draws it clipped to each word, in `highlight`, for as long as
   * that word is spoken — a karaoke sweep. Builder-only; `content` is still
   * the full line, so the element renders sensibly without it.
   */
  captionWords?: CaptionWord[];
  /** Colour used for the word being spoken. Default `#38bdf8`. */
  highlight?: string;
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

/** Chroma key (green/blue screen) options for image and video layers. */
export interface ChromaKeyConfig {
  /** Key colour to remove. `"green"`, `"#00ff00"`… Defaults to green. */
  color?: string;
  /** 0–1 similarity: how close to the key colour counts as background. Default 0.01. */
  similarity?: number | string;
  /** 0–1 blend: softens the edge between keyed and kept pixels. Default 0. */
  blend?: number | string;
  /** Removes colour bleed from the key colour on the subject. Default false. */
  despill?: boolean;
}

export interface ImageElement extends BaseElement {
  type: "image";
  src: string;
  width?: number | string;
  height?: number | string;
  fit?: MediaFit;
  /** Key out a background colour. `true` keys green with defaults. */
  chromaKey?: boolean | ChromaKeyConfig;
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
  /**
   * Where to stop reading the source. Duration is derived from it when
   * `duration` is unset, so `{ trimStart: "0:32", trimEnd: "0:45" }` plays 13s.
   */
  trimEnd?: number | string;
  loop?: boolean;
  volume?: number | string;
  /** Key out a background colour (green/blue screen). `true` keys green. */
  chromaKey?: boolean | ChromaKeyConfig;
}

export type ElementInput = TextElement | ImageElement | HtmlElement | VideoElement;

// Backward compatible alias
export type TextOverlay = TextElement;
