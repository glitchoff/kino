export { render, compile } from "./pipeline/index.js";
export { renderFromArgv } from "./render-from-argv.js";
export type { RenderFromArgvOptions } from "./render-from-argv.js";
export { parseRenderArgs, RENDER_FLAGS } from "./cli-args.js";
export type { ParsedArgs } from "./cli-args.js";
export { selectScene } from "./normalize/composition.js";
export {
  tts,
  isTtsSpec,
  resolveVoice,
  ensureVoice,
  isPiperAvailable,
  synthesizeToWav,
  defaultVoiceDir,
  defaultTtsCacheDir,
  describeVoices,
  KNOWN_VOICES,
  DEFAULT_VOICE,
} from "./tts/piper.js";
export type { TtsSpec, TtsOptions, VoiceSpec } from "./tts/piper.js";
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
  withDefaults,
  CompositionBuilder,
  SceneBuilder,
} from "./builder/index.js";
export type {
  CompositionOptions,
  SceneOptions,
  SceneInput,
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
