export { render, compile } from "./pipeline/index.js";
export {
  composition,
  defineComposition,
  toComposition,
  text,
  image,
  video,
  html,
  animate,
  fadeIn,
  fadeOut,
  slideIn,
  popIn,
  CompositionBuilder,
  SceneBuilder,
} from "./builder/index.js";
export type {
  CompositionOptions,
  SceneOptions,
  ElementOptions,
  TextOptions,
  MediaOptions,
  VideoOptions,
  HtmlOptions,
  AnimateOptions,
  Position,
} from "./builder/index.js";
export {
  normalizeComposition,
  normalizeBackground,
  normalizeElement,
} from "./normalize/index.js";
export { validateComposition, KinoValidationError } from "./validate/index.js";
export type { ValidationIssue } from "./validate/index.js";
export type {
  KinoComposition,
  NormalizedComposition,
  RenderOptions,
  CompileResult,
  TextElement,
  ImageElement,
  HtmlElement,
  VideoElement,
  AudioTrack,
  BackgroundInput,
  BackgroundConfig,
  ElementInput,
  KinoScene,
  Easing,
  AnimationValue,
  ElementAnimation,
  MediaFit,
  ObjectFit,
} from "./types/index.js";
