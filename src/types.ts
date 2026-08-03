export type ColorBackground = {
  type: "color";
  value: string;
};

export type ImageBackground = {
  type: "image";
  src: string;
};

export type GradientBackground = {
  type: "gradient";
  from: string;
  to: string;
  direction?: "vertical" | "horizontal";
};

export type VideoBackground = {
  type: "video";
  src: string;
  loop?: boolean;
};

export type BackgroundConfig =
  | ColorBackground
  | ImageBackground
  | GradientBackground
  | VideoBackground;

export type BackgroundInput = string | BackgroundConfig;

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

export type ElementInput = TextElement | ImageElement | VideoElement;

export type Easing = "linear" | "easeIn" | "easeOut" | "easeInOut";

export interface AnimationValue {
  from: number;
  to: number;
  duration: number;
  delay?: number;
  easing?: Easing;
}

export interface ElementAnimation {
  opacity?: AnimationValue;
  x?: AnimationValue;
  y?: AnimationValue;
  scale?: AnimationValue;
}

// Backward compatible alias
export type TextOverlay = TextElement;

export interface AudioTrack {
  src: string;
  startTime?: number;
  offset?: number;
  duration?: number;
  volume?: number;
  loop?: boolean;
  fadeIn?: number;
  fadeOut?: number;
}

export interface TemplateProps {
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
  type: "text" | "image" | "video";
  props: TemplateProps;
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

export type VideoEncoder =
  | "libx264"
  | "h264_nvenc"
  | "hevc_nvenc"
  | "h264_qsv"
  | "h264_amf"
  | "h264_videotoolbox"
  | "auto";

export interface RenderOptions {
  output: string;
  ffmpegPath?: string;
  overwrite?: boolean;
  verbose?: boolean;
  encoder?: VideoEncoder;
  preset?: string;
  kinoPath?: string;
  unsafeInlineText?: boolean;
}

export interface CompileResult {
  args: string[];
  filtergraph?: string;
  kinoFilePath: string;
}
