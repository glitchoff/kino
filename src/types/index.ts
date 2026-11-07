// Background
export type {
  ColorBackground,
  ImageBackground,
  GradientBackground,
  VideoBackground,
  BackgroundConfig,
  BackgroundInput,
} from "./background.js";

// Audio
export type { AudioTrack } from "./audio.js";

// Animation
export type { Easing, AnimationValue, ElementAnimation } from "./animation.js";

// Elements
export type {
  BaseElement,
  TextElement,
  MediaFit,
  ObjectFit,
  ImageElement,
  HtmlElement,
  VideoElement,
  ElementInput,
  TextOverlay,
  ChromaKeyConfig,
} from "./elements.js";

// Templates
export type { TemplateProps, KinoTemplate } from "./template.js";

// Composition
export type {
  KinoTransitionType,
  KinoTransition,
  KinoScene,
  KinoComposition,
  NarrationFit,
  SceneDuration,
} from "./composition.js";

// Normalized
export type {
  NormalizedScene,
  NormalizedComposition,
  NormalizedElement,
  NormalizedTextElement,
  NormalizedImageElement,
  NormalizedHtmlElement,
  NormalizedVideoElement,
  NormalizedAudioTrack,
  NormalizedAnimationValue,
  NormalizedElementAnimation,
  NormalizedTransition,
} from "./normalized.js";

// Render
export type { VideoEncoder, RenderOptions, CompileResult } from "./render.js";
export { PREVIEW_DEFAULT_HEIGHT, resolvePreviewHeight } from "./render.js";
