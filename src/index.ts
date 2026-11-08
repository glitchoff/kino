export { render, compile, exportComposition } from "./pipeline/index.js";
export { getFFmpegBinaryPath } from "./encoder/probe.js";
export { inspect } from "./inspect/index.js";
export type {
  InspectReport,
  InspectOptions,
  InspectedScene,
  InspectedElement,
  InspectIssue,
  IssueSeverity,
  Box,
} from "./inspect/index.js";
export { renderFromArgv } from "./render-from-argv.js";
export type { RenderFromArgvOptions } from "./render-from-argv.js";
export { parseRenderArgs, RENDER_FLAGS } from "./cli-args.js";
export type { ParsedArgs } from "./cli-args.js";
export { selectScene } from "./normalize/composition.js";
export {
  tts,
  voice,
  isVoice,
  isTtsSpec,
  wavDuration,
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
export type { TtsSpec, TtsOptions, VoiceSpec, Voice } from "./tts/piper.js";
export {
  composition,
  defineComposition,
  toComposition,
  text,
  image,
  video,
  html,
  takumi,
  shape,
  rect,
  ellipse,
  line,
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
  ShapeOptions,
  AnimateOptions,
  Position,
} from "./builder/index.js";
export {
  captions,
  captionsAsync,
  captionElements,
  captionImages,
  timeWords,
  evenTimings,
  groupWords,
  buildCaptionLines,
  splitWords,
  cleanWord,
  isAlignmentAvailable,
  warmAlignmentModel,
  installAligner,
  alignerInstallDir,
  defaultCaptionCacheDir,
} from "./captions/index.js";
export type {
  CaptionOptions,
  CaptionImageOptions,
  CaptionStyle,
  CaptionTiming,
  CaptionLine,
  WordTiming,
} from "./captions/index.js";
export {
  normalizeComposition,
  normalizeBackground,
  normalizeElement,
  resolveSceneDuration,
  NARRATION_PAD,
  estimateTextWidth,
  wrapText,
} from "./normalize/index.js";
export {
  measureText,
  measureTexts,
  measureSpace,
  defaultFontFile,
} from "./measure/index.js";
export type {
  MeasureTextOptions,
  TextMeasurement,
  MeasureSource,
} from "./measure/index.js";
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
  SceneDuration,
  NarrationFit,
  Easing,
  AnimationValue,
  ElementAnimation,
  MediaFit,
  ObjectFit,
} from "./types/index.js";
