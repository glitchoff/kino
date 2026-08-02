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

export interface BaseElement {
  id?: string;
  x?: number | string;
  y?: number | string;
  startTime?: number;
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
}

export interface ImageElement extends BaseElement {
  type: "image";
  src: string;
  width?: number;
  height?: number;
}

export type ElementInput = TextElement | ImageElement;

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

export interface KinoScene {
  id?: string;
  duration: number;
  startTime?: number;
  background?: BackgroundInput;
  elements?: ElementInput[];
}

export interface KinoComposition {
  width?: number;
  height?: number;
  fps?: number;
  timeline?: "sequential" | "absolute";
  scenes: KinoScene[];
  audio?: AudioTrack | AudioTrack[];
}

export interface NormalizedScene {
  id: string;
  startTime: number;
  duration: number;
  background: BackgroundConfig;
  elements: ElementInput[];
}

export interface NormalizedComposition {
  width: number;
  height: number;
  duration: number;
  fps: number;
  timeline: "sequential" | "absolute";
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
