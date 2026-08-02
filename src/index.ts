export { render, compile } from "./render.js";
export {
  normalizeComposition,
  normalizeBackground,
  normalizeElement,
} from "./normalize.js";
export { validateComposition, KinoValidationError } from "./validate.js";
export type { ValidationIssue } from "./validate.js";
export type {
  KinoComposition,
  NormalizedComposition,
  RenderOptions,
  CompileResult,
  TextElement,
  ImageElement,
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
} from "./types.js";
