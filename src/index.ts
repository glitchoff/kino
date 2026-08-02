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
  AudioTrack,
  BackgroundInput,
  BackgroundConfig,
  ElementInput,
  KinoScene,
  Easing,
  AnimationValue,
  ElementAnimation,
  ObjectFit,
} from "./types.js";
