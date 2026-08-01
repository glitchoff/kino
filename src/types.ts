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
  background?: BackgroundInput;
  elements?: ElementInput[];
}

export interface KinoComposition {
  width?: number;
  height?: number;
  duration?: number;
  background?: BackgroundInput;
  fps?: number;
  text?: TextElement | TextElement[];
  elements?: ElementInput[];
  scenes?: KinoScene[];
  audio?: AudioTrack | AudioTrack[];
}

export interface NormalizedComposition {
  width: number;
  height: number;
  duration: number;
  fps: number;
  background: BackgroundConfig;
  elements: ElementInput[];
  scenes: {
    id: string;
    duration: number;
    background: BackgroundConfig;
    elements: ElementInput[];
  }[];
  audio: AudioTrack[];
}

export interface RenderOptions {
  output: string;
  ffmpegPath?: string;
  overwrite?: boolean;
  verbose?: boolean;
}

export interface CompileResult {
  args: string[];
  filtergraph?: string;
}
