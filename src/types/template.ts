import type { AudioTrack } from "./audio.js";
import type { ElementAnimation } from "./animation.js";
import type { MediaFit } from "./elements.js";

export interface TemplateProps {
  html?: string;
  css?: string;
  fontSize?: number;
  fontColor?: string;
  fontFile?: string;
  box?: boolean;
  boxColor?: string;
  boxPadding?: number;
  maxWidth?: number;
  textAlign?: "left" | "center" | "right";
  lineHeight?: number;
  stroke?: { color: string; width: number };
  shadow?: { color: string; x?: number; y?: number };
  x?: number | string;
  y?: number | string;
  offsetX?: number;
  offsetY?: number;
  animation?: ElementAnimation;
  width?: number;
  height?: number;
  fit?: MediaFit;
  deviceScaleFactor?: number;
  trimStart?: number;
  loop?: boolean;
  volume?: number;
  sfx?: string | AudioTrack;
  zIndex?: number;
  startAt?: number;
  duration?: number;
}

export interface KinoTemplate {
  id: string;
  type: "text" | "image" | "html" | "video";
  props: TemplateProps;
}
