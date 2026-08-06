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
