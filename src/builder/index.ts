/**
 * Code-first composition builder.
 *
 * JSON compositions are fine for data, but real videos want loops, variables,
 * computed timings, shared constants and functions. This module gives you the
 * same underlying `KinoComposition` object with a small, chainable API — no
 * schema to memorise and full TypeScript inference.
 *
 * ```ts
 * import { composition, text, image, render } from "@glitchoff/kino";
 *
 * const comp = composition({ width: 1080, height: 1920 })
 *   .scene({ duration: 5, background: "#0f172a" }, (s) =>
 *     s.text("Hello Kino", { fontSize: 84, color: "#fff", x: "center", y: "center" })
 *   )
 *   .build();
 *
 * await render(comp, { output: "out.mp4" });
 * ```
 *
 * Every builder returns a plain object, so anything here can be mixed with
 * hand-written JSON — the output is exactly `KinoComposition`.
 */

import type {
  KinoComposition,
  KinoScene,
  KinoTransition,
  KinoTransitionType,
  SceneDuration,
} from "../types/composition.js";
import type {
  AudioTrack,
} from "../types/audio.js";
import type { BackgroundInput } from "../types/background.js";
import { TAKUMI_PREFIX } from "../remote/takumi.js";
import type {
  ElementInput,
  TextElement,
  ImageElement,
  HtmlElement,
  ShapeElement,
  VideoElement,
  ChromaKeyConfig,
} from "../types/elements.js";
import type { AnimationValue, Easing, ElementAnimation, AnimatableValue } from "../types/animation.js";
import type { ColorAdjust, BlendMode, ElementMask } from "../types/elements.js";
import type { KinoTemplate } from "../types/template.js";
import { isVoice, tts, type TtsOptions, type TtsSpec, type Voice } from "../tts/piper.js";

/** Position helpers: `"center"` or ffmpeg-style expressions are both accepted. */
export type Position = number | string;

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

/** `animate({ from: 0, to: 1, duration: 0.5 })` — short form, defaults to linear. */
export interface AnimateOptions {
  from: number | string;
  to: number | string;
  duration: number | string;
  delay?: number | string;
  easing?: Easing;
}

export function animate(options: AnimateOptions): AnimationValue {
  return { ...options };
}

/** Fade in over `duration` seconds (default 0.5). */
export function fadeIn(duration: number | string = 0.5, easing: Easing = "easeOut"): AnimationValue {
  return { from: 0, to: 1, duration, easing };
}

/** Fade out — the builder flips `from`/`to` so it reads naturally. */
export function fadeOut(duration: number | string = 0.5, easing: Easing = "easeIn"): AnimationValue {
  return { from: 1, to: 0, duration, easing };
}

/** Move from an offset to the element's final position. */
export function slideIn(
  axis: "x" | "y",
  distance: number | string,
  duration: number | string = 0.5,
  easing: Easing = "easeOut"
): AnimationValue {
  const from = axis === "x" ? `-${distance}` : `-${distance}`;
  return { from, to: 0, duration, easing };
}

export function popIn(duration: number | string = 0.4, easing: Easing = "easeOut"): AnimationValue {
  return { from: 0.8, to: 1, duration, easing };
}

/**
 * Offset an animation in time.
 *
 * ```ts
 * fadeIn(0.4);                    // starts with the element
 * shift(fadeIn(0.4), 1);          // starts one second after it
 * shift(slideIn("x", 80), -0.2);  // starts before it
 * ```
 *
 * Works on keyframed animations too, moving every keyframe. A negative delay
 * is clamped to zero, since an animation cannot begin before its element.
 */
export function shift(value: AnimatableValue, by: number | string): AnimatableValue {
  const offset = typeof by === "number" ? by : Number(by);
  if (!Number.isFinite(offset) || offset === 0) return value;

  if ("keyframes" in value) {
    return {
      ...value,
      keyframes: value.keyframes.map((k) => {
        const at = typeof k.at === "number" ? k.at : Number(k.at);
        return { ...k, at: Math.max(0, (Number.isFinite(at) ? at : 0) + offset) };
      }),
    };
  }

  const delay = (typeof value.delay === "number" ? value.delay : Number(value.delay ?? 0)) || 0;
  const shifted = Math.max(0, delay + offset);
  if (shifted === 0) {
    const { delay: _drop, ...rest } = value;
    return rest;
  }
  return { ...value, delay: shifted };
}

// ---------------------------------------------------------------------------
// Shared element options
// ---------------------------------------------------------------------------

export interface ElementOptions {
  id?: string;
  x?: Position;
  y?: Position;
  offsetX?: number | string;
  offsetY?: number | string;
  startAt?: number | string;
  duration?: number | string;
  zIndex?: number | string;
  sfx?: string | AudioTrack;
  animation?: ElementAnimation;
  /** Brightness, contrast, saturation, hue, gamma, lift and gain. */
  grade?: ColorAdjust;
  /** Composite onto what is beneath. Default `normal` (plain overlay). */
  blend?: BlendMode;
  /** Limit where the element is visible. */
  mask?: ElementMask;
  /** Sub-frame samples (number) or `{ samples, shutter }`. Off by default. */
  motionBlur?: number | { samples?: number; shutter?: number };
}

/** Options accepted by `text()` — element options plus text styling. */
export interface TextOptions extends ElementOptions {
  fontSize?: number | string;
  color?: string;
  fontFile?: string;
  box?: boolean;
  boxColor?: string;
  boxPadding?: number | string;
  maxWidth?: number | string;
  align?: "left" | "center" | "right";
  lineHeight?: number | string;
  stroke?: { color: string; width: number | string };
  shadow?: { color: string; x?: number | string; y?: number | string };
}

export interface MediaOptions extends ElementOptions {
  width?: number | string;
  height?: number | string;
  fit?: "contain" | "cover" | "fill" | "none";
  /**
   * Key out a background colour (green/blue screen). `true` keys pure green with
   * tight defaults; pass an object to tune `color`, `similarity` and `blend`.
   */
  chromaKey?: boolean | ChromaKeyConfig;
}

export interface VideoOptions extends MediaOptions {
  trimStart?: number | string;
  /** Stop reading the source here; sets the duration when `duration` is unset. */
  trimEnd?: number | string;
  loop?: boolean;
  volume?: number | string;
}

export interface HtmlOptions extends ElementOptions {
  width: number | string;
  height: number | string;
  css?: string;
  fit?: "contain" | "cover" | "fill" | "none";
  backgroundColor?: string;
  deviceScaleFactor?: number | string;
}

function baseFrom(options: ElementOptions): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (options.id !== undefined) out.id = options.id;
  if (options.x !== undefined) out.x = options.x;
  if (options.y !== undefined) out.y = options.y;
  if (options.offsetX !== undefined) out.offsetX = options.offsetX;
  if (options.offsetY !== undefined) out.offsetY = options.offsetY;
  if (options.startAt !== undefined) out.startAt = options.startAt;
  if (options.duration !== undefined) out.duration = options.duration;
  if (options.zIndex !== undefined) out.zIndex = options.zIndex;
  if (options.sfx !== undefined) out.sfx = options.sfx;
  if (options.animation !== undefined) out.animation = options.animation;
  if (options.grade !== undefined) out.grade = options.grade;
  if (options.blend !== undefined) out.blend = options.blend;
  if (options.mask !== undefined) out.mask = options.mask;
  if (options.motionBlur !== undefined) out.motionBlur = options.motionBlur;
  return out;
}

// ---------------------------------------------------------------------------
// Element factories — these work standalone or inside a scene
// ---------------------------------------------------------------------------

export function text(content: string, options: TextOptions = {}): TextElement {
  const { fontSize, color, fontFile, box, boxColor, boxPadding, maxWidth, align, lineHeight, stroke, shadow } =
    options;
  return {
    type: "text",
    content,
    ...(fontSize !== undefined ? { fontSize } : {}),
    ...(color !== undefined ? { fontColor: color } : {}),
    ...(fontFile !== undefined ? { fontFile } : {}),
    ...(box !== undefined ? { box } : {}),
    ...(boxColor !== undefined ? { boxColor } : {}),
    ...(boxPadding !== undefined ? { boxPadding } : {}),
    ...(maxWidth !== undefined ? { maxWidth } : {}),
    ...(align !== undefined ? { textAlign: align } : {}),
    ...(lineHeight !== undefined ? { lineHeight } : {}),
    ...(stroke !== undefined ? { stroke } : {}),
    ...(shadow !== undefined ? { shadow } : {}),
    ...baseFrom(options),
  } as TextElement;
}

export function image(src: string, options: MediaOptions = {}): ImageElement {
  const { width, height, fit, chromaKey } = options;
  return {
    type: "image",
    src,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(fit !== undefined ? { fit } : {}),
    ...(chromaKey !== undefined ? { chromaKey } : {}),
    ...baseFrom(options),
  } as ImageElement;
}

export function video(src: string, options: VideoOptions = {}): VideoElement {
  const { width, height, fit, trimStart, trimEnd, loop, volume, chromaKey } = options;
  return {
    type: "video",
    src,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(fit !== undefined ? { fit } : {}),
    ...(trimStart !== undefined ? { trimStart } : {}),
    ...(trimEnd !== undefined ? { trimEnd } : {}),
    ...(loop !== undefined ? { loop } : {}),
    ...(volume !== undefined ? { volume } : {}),
    ...(chromaKey !== undefined ? { chromaKey } : {}),
    ...baseFrom(options),
  } as VideoElement;
}

export interface ShapeOptions extends ElementOptions {
  fill?: string;
  stroke?: string;
  strokeWidth?: number | string;
  radius?: number | string;
  x1?: number | string;
  y1?: number | string;
  x2?: number | string;
  y2?: number | string;
}

/** A rectangle, ellipse or line, drawn to a PNG at compile time. */
export function shape(
  kind: "rect" | "ellipse" | "line",
  options: ShapeOptions & { width: number | string; height: number | string }
): ShapeElement {
  const { width, height, fill, stroke, strokeWidth, radius, x1, y1, x2, y2 } = options;
  return {
    type: "shape",
    shape: kind,
    width,
    height,
    ...(fill !== undefined ? { fill } : {}),
    ...(stroke !== undefined ? { stroke } : {}),
    ...(strokeWidth !== undefined ? { strokeWidth } : {}),
    ...(radius !== undefined ? { radius } : {}),
    ...(x1 !== undefined ? { x1 } : {}),
    ...(y1 !== undefined ? { y1 } : {}),
    ...(x2 !== undefined ? { x2 } : {}),
    ...(y2 !== undefined ? { y2 } : {}),
    ...baseFrom(options),
  } as ShapeElement;
}

/** A filled or outlined rectangle. */
export function rect(options: ShapeOptions & { width: number | string; height: number | string }): ShapeElement {
  return shape("rect", options);
}

/** A filled or outlined ellipse filling its box. */
export function ellipse(options: ShapeOptions & { width: number | string; height: number | string }): ShapeElement {
  return shape("ellipse", options);
}

/** A line between two points inside its box. */
export function line(options: ShapeOptions & { width: number | string; height: number | string }): ShapeElement {
  return shape("line", options);
}

/** HTML rendered by Takumi, with no browser. See `SceneBuilder.tak()`. */
export function takumi(markup: string, options: HtmlOptions): HtmlElement {
  return html(TAKUMI_PREFIX + markup, options);
}

export function html(markup: string, options: HtmlOptions): HtmlElement {
  const { width, height, css, fit, backgroundColor, deviceScaleFactor } = options;
  return {
    type: "html",
    html: markup,
    width,
    height,
    ...(css !== undefined ? { css } : {}),
    ...(fit !== undefined ? { fit } : {}),
    ...(backgroundColor !== undefined ? { backgroundColor } : {}),
    ...(deviceScaleFactor !== undefined ? { deviceScaleFactor } : {}),
    ...baseFrom(options),
  } as HtmlElement;
}

// ---------------------------------------------------------------------------
// Reusable components
// ---------------------------------------------------------------------------

/**
 * Derive a factory with defaults baked in, so a piece of video can be defined
 * once and reused with different data.
 *
 * ```ts
 * const Title = withDefaults(text, { fontSize: 84, color: "#fff", x: "center", y: "center" });
 *
 * Title("Hello");                        // defaults
 * Title("Hello", { color: "#38bdf8" });  // per-call options win
 * ```
 *
 * Defaults merge one level deep: passing `stroke` replaces the default
 * `stroke` wholesale rather than merging keys inside it. That keeps the
 * behaviour predictable for nested option objects such as `animation`.
 */
export function withDefaults<I, O extends object, R>(
  factory: (input: I, options?: O) => R,
  defaults: O
): (input: I, options?: Partial<O>) => R {
  return (input: I, options?: Partial<O>) => factory(input, { ...defaults, ...options } as O);
}

/**
 * Attach options to an element that was made without them.
 *
 * Where `withDefaults` derives a factory from a look, `withOptions` dresses an
 * element that already exists — useful when the element comes from elsewhere
 * (a caption builder, a JSON file, another component) and still needs a
 * position, a start time or an animation.
 *
 * ```ts
 * const title = text("Hello", { fontSize: 96 });
 * withOptions(title, { y: "center", animation: fadeIn(0.4) });
 * ```
 *
 * Later options win over the element's own, and an empty value is skipped
 * rather than written, so `{ y: undefined }` leaves the element alone.
 */
export function withOptions<E extends ElementInput>(
  element: E,
  options: ElementOptions & Partial<Omit<TextOptions, keyof ElementOptions>>,
): E {
  const base = baseFrom(options);
  const { color, fontSize, align, box, boxColor, boxPadding, maxWidth, lineHeight, stroke, shadow, fontFile } =
    options as TextOptions;
  // The factories rename some options (`color` becomes `fontColor`), so the
  // same mapping has to happen here for the option to take effect.
  const renamed: Record<string, unknown> = {
    ...(color !== undefined ? { fontColor: color } : {}),
    ...(fontSize !== undefined ? { fontSize } : {}),
    ...(align !== undefined ? { textAlign: align } : {}),
    ...(box !== undefined ? { box } : {}),
    ...(boxColor !== undefined ? { boxColor } : {}),
    ...(boxPadding !== undefined ? { boxPadding } : {}),
    ...(maxWidth !== undefined ? { maxWidth } : {}),
    ...(lineHeight !== undefined ? { lineHeight } : {}),
    ...(stroke !== undefined ? { stroke } : {}),
    ...(shadow !== undefined ? { shadow } : {}),
    ...(fontFile !== undefined ? { fontFile } : {}),
  };
  const out: Record<string, unknown> = { ...element };
  for (const [key, value] of Object.entries({ ...renamed, ...base })) {
    if (value !== undefined) out[key] = value;
  }
  // An animation given on its own (`fadeIn()`) is shorthand for the opacity
  // channel. Storing it bare would be silently dropped by normalization, which
  // only reads named channels.
  const anim = out.animation;
  if (isPlainObject(anim) && !ANIMATION_CHANNELS.some((ch) => ch in anim)) {
    out.animation = { opacity: anim };
  }
  return out as E;
}

const ANIMATION_CHANNELS = ["opacity", "x", "y", "scale", "steps"] as const;

/**
 * Combine element options into one set of defaults.
 *
 * `withDefaults` merges one level deep, which means layering two presets loses
 * the first one's `stroke` (or `animation`, or `shadow`) wholesale. `preset`
 * merges those nested groups key by key instead, so a base look can be built
 * up in pieces.
 *
 * ```ts
 * const dark = preset({ color: "#fff", stroke: { color: "#000", width: 4 } });
 * const big  = preset({ fontSize: 96 }, dark);
 * big.stroke; // { color: "#000", width: 4 } — kept from `dark`
 * ```
 *
 * `preset()` returns plain options, so it feeds `withDefaults`, `withOptions`
 * or a factory call directly.
 */
export function preset<O extends object>(...layers: (Partial<O> | undefined)[]): O {
  const out: Record<string, unknown> = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined) continue;
      const current = out[key];
      if (isPlainObject(current) && isPlainObject(value)) {
        out[key] = { ...current, ...value };
      } else {
        out[key] = value;
      }
    }
  }
  return out as O;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Anything that can stand where an element stands: an element, a list of
 * elements, or a function producing either — so a component can be a plain
 * object, a lazy factory or a group of parts.
 */
export type ElementPart =
  | ElementInput
  | ElementInput[]
  | (() => ElementInput | ElementInput[])
  | ElementPart[];

/**
 * Flatten elements into a plain list.
 *
 * `scene()` takes a list, but a component often wants to hand back a group —
 * a title with its subtitle, a lower third with its bar — and nesting those by
 * hand means spreading arrays at every call site. `elements()` accepts them in
 * any nesting, runs any factories, and returns one flat list.
 *
 * ```ts
 * const lowerThird = (name: string) => elements(
 *   rect({ width: 12, height: 120, x: 80, y: "bottom-160", fill: "#38bdf8" }),
 *   text(name, { x: 116, y: "bottom-150", fontSize: 52 }),
 * );
 *
 * const intro = scene({ for: 3 }, elements(Title("Hello"), lowerThird("Alice")));
 * ```
 *
 * Factories are called once, at flatten time, so an element that depends on
 * something expensive is only built when it is used.
 */
export function elements(...parts: ElementPart[]): ElementInput[] {
  const out: ElementInput[] = [];

  const walk = (part: ElementPart): void => {
    if (typeof part === "function") {
      walk(part());
      return;
    }
    if (Array.isArray(part)) {
      for (const inner of part) walk(inner as ElementPart);
      return;
    }
    if (part) out.push(part);
  };

  for (const part of parts) walk(part);
  return out;
}

// ---------------------------------------------------------------------------
// Scene builder
// ---------------------------------------------------------------------------

export interface SceneOptions {
  id?: string;
  /**
   * A fixed length, or `{ fit: voice }` to size the scene from a measured line
   * of speech (plus `pad`, default 0.6s).
   */
  duration: SceneDuration;
  background?: BackgroundInput;
  transition?: KinoTransitionType | KinoTransition;
}

export class SceneBuilder {
  private readonly elements: ElementInput[] = [];
  private readonly narration: TtsSpec[] = [];

  constructor(private readonly options: SceneOptions) {}

  /** Append a raw element (or the result of a helper such as `text()`). */
  add(element: ElementInput): this {
    this.elements.push(element);
    return this;
  }

  text(content: string, options?: TextOptions): this {
    return this.add(text(content, options));
  }

  image(src: string, options?: MediaOptions): this {
    return this.add(image(src, options));
  }

  video(src: string, options?: VideoOptions): this {
    return this.add(video(src, options));
  }

  html(markup: string, options: HtmlOptions): this {
    return this.add(html(markup, options));
  }

  /**
   * HTML rendered by Takumi, with no browser.
   *
   * Sugar for `html("tak:" + markup, options)`. Takumi supports less CSS than
   * Chrome and never runs scripts; use `html()` when you need either.
   */
  tak(markup: string, options: HtmlOptions): this {
    return this.add(takumi(markup, options));
  }

  /**
   * Declare speech for this scene. A string is synthesised lazily by Piper at
   * render time; a `Voice` was already synthesised by `await voice(...)`, so
   * its audio is reused as-is.
   *
   * ```ts
   * s.say("नमस्ते, welcome to Kino", { voice: "hi_IN-rohan" });
   * s.say(await voice("Already measured"));   // same audio, no re-synthesis
   * ```
   */
  say(text: string, options?: TtsOptions): this;
  say(voice: Voice): this;
  say(textOrVoice: string | Voice, options?: TtsOptions): this {
    this.narration.push(isVoice(textOrVoice) ? textOrVoice.spec : tts(textOrVoice, options));
    return this;
  }

  /** Append many elements at once — handy with `map`/`flatMap`. */
  addAll(elements: ElementInput[]): this {
    for (const element of elements) this.add(element);
    return this;
  }

  build(): KinoScene {
    return {
      ...(this.options.id !== undefined ? { id: this.options.id } : {}),
      duration: this.options.duration,
      ...(this.options.background !== undefined ? { background: this.options.background } : {}),
      elements: this.elements,
      // Normalization lifts these into composition-level audio at the scene's
      // start time, so transitions and offsets stay correct.
      ...(this.narration.length ? { narration: this.narration } : {}),
      ...(this.options.transition !== undefined
        ? {
            transition:
              typeof this.options.transition === "string"
                ? { type: this.options.transition, duration: 0.5 }
                : this.options.transition,
          }
        : {}),
    };
  }
}

// ---------------------------------------------------------------------------
// Composition builder
// ---------------------------------------------------------------------------

export interface CompositionOptions {
  width?: number | string;
  height?: number | string;
  fps?: number | string;
  audio?: AudioTrack | AudioTrack[];
  templates?: KinoTemplate[];
  /** A grade applied once to the finished frame. */
  grade?: ColorAdjust;
}

type SceneCallback = (scene: SceneBuilder) => void | SceneBuilder;

/** Anything `.scene()` accepts: options, a pre-built scene, or a builder. */
export type SceneInput = SceneOptions | KinoScene | SceneBuilder;

function isSceneOptions(input: SceneInput): input is SceneOptions {
  // A scene object has `elements`; options never do.
  return !("elements" in input) && !(input instanceof SceneBuilder);
}

export class CompositionBuilder {
  private readonly scenes: KinoScene[] = [];
  private readonly templates: KinoTemplate[] = [];
  private audioTracks: AudioTrack | AudioTrack[] | undefined = undefined;

  private options: CompositionOptions;

  constructor(options: CompositionOptions = {}) {
    this.options = options;
    this.templates = options.templates ? [...options.templates] : [];
    this.audioTracks = options.audio;
  }

  /**
   * Add a scene. Accepts scene options plus an optional callback (which
   * receives a `SceneBuilder`), or a pre-built scene / builder directly.
   *
   * ```ts
   * comp.scene({ duration: 5 }, (s) => s.text("Hi"));
   * comp.scene(lowerThird("Alice").build());   // reuse a component
   * ```
   */
  scene(input: SceneOptions, build?: SceneCallback): this;
  scene(scene: KinoScene | SceneBuilder): this;
  scene(input: SceneInput, build?: SceneCallback): this {
    if (isSceneOptions(input)) {
      const scene = new SceneBuilder(input);
      if (build) build(scene);
      this.scenes.push(scene.build());
    } else {
      this.scenes.push(input instanceof SceneBuilder ? input.build() : input);
    }
    return this;
  }

  /** Append a pre-built scene object. */
  addScene(scene: KinoScene): this {
    this.scenes.push(scene);
    return this;
  }

  /** Append many scenes at once — pairs nicely with `.map()`. */
  addScenes(scenes: KinoScene[]): this {
    this.scenes.push(...scenes);
    return this;
  }

  /** Set the audio bed for the whole composition. */
  audio(tracks: AudioTrack | AudioTrack[]): this {
    this.audioTracks = tracks;
    return this;
  }

  template(template: KinoTemplate): this {
    this.templates.push(template);
    return this;
  }

  /** A grade applied once to the finished frame. Replaces any earlier one. */
  grade(color: ColorAdjust): this {
    this.options = { ...this.options, grade: color };
    return this;
  }

  build(): KinoComposition {
    return {
      ...(this.options.width !== undefined ? { width: this.options.width } : {}),
      ...(this.options.height !== undefined ? { height: this.options.height } : {}),
      ...(this.options.fps !== undefined ? { fps: this.options.fps } : {}),
      scenes: this.scenes,
      ...(this.audioTracks !== undefined ? { audio: this.audioTracks } : {}),
      ...(this.templates.length ? { templates: this.templates } : {}),
      ...(this.options.grade !== undefined ? { grade: this.options.grade } : {}),
    };
  }
}

/** Start a new composition. Chain `.scene(...)` then `.build()`. */
export function composition(options: CompositionOptions = {}): CompositionBuilder {
  return new CompositionBuilder(options);
}

// ---------------------------------------------------------------------------
// Scenes as values
// ---------------------------------------------------------------------------

/**
 * A scene, as a plain value.
 *
 * The builder chains scenes onto a composition, which means a scene cannot be
 * named, reused or tested on its own. This returns the same `KinoScene` the
 * builder would produce, so a scene can be held in a variable and merged
 * wherever it is needed — a chorus used three times is written once.
 *
 * ```ts
 * const intro = scene({ for: 5, bg: "#0f172a" }, [text("Hello")]);
 * const outro = scene({ for: 3, bg: "#111827", transition: "fade" }, [text("Bye")]);
 *
 * await render(merge(intro, outro), { output: "out.mp4" });
 * ```
 */
export interface SceneProps {
  /** How long the scene lasts. Same values the builder's `duration` takes. */
  for: SceneDuration;
  /** A colour, or a background config. */
  bg?: BackgroundInput;
  /** How this scene arrives. The first scene of a composition cannot have one. */
  transition?: KinoTransitionType | KinoTransition;
  id?: string;
}

export function scene(props: SceneProps, elements: ElementInput[] = []): KinoScene {
  const { for: duration, bg, transition, id } = props;
  return {
    ...(id !== undefined ? { id } : {}),
    duration,
    ...(bg !== undefined ? { background: bg } : {}),
    elements,
    ...(transition !== undefined
      ? {
          transition:
            typeof transition === "string" ? { type: transition, duration: 0.5 } : transition,
        }
      : {}),
  };
}

/** Anything `merge()` accepts: a scene, or something holding scenes. */
export type MergeInput = KinoScene | KinoComposition | CompositionBuilder | MergeInput[];

/**
 * Join scenes into a composition.
 *
 * Accepts scenes, compositions and builders in any nesting, so two videos can
 * be joined as easily as two scenes. Later arguments play after earlier ones.
 *
 * ```ts
 * merge(intro, chorus, chorus, outro);
 * merge(partOne, partTwo);              // compositions, flattened
 * ```
 *
 * Options come from the first composition passed; anything after it
 * contributes scenes only.
 */
export function merge(...parts: MergeInput[]): KinoComposition {
  const scenes: KinoScene[] = [];
  let base: CompositionOptions | undefined;

  const walk = (part: MergeInput): void => {
    if (Array.isArray(part)) {
      for (const inner of part) walk(inner);
      return;
    }
    if (part instanceof CompositionBuilder) {
      const built = part.build();
      base ??= {
        width: built.width,
        height: built.height,
        fps: built.fps,
        audio: built.audio,
        templates: built.templates,
        grade: built.grade,
      };
      scenes.push(...built.scenes);
      return;
    }
    // A composition has `scenes`; a scene has `duration`. Checking `scenes`
    // first is what tells them apart, since a scene never has one.
    if ("scenes" in part) {
      base ??= {
        width: part.width,
        height: part.height,
        fps: part.fps,
        audio: part.audio,
        templates: part.templates,
        grade: part.grade,
      };
      scenes.push(...part.scenes);
      return;
    }
    scenes.push(part);
  };

  for (const part of parts) walk(part);

  return {
    ...(base?.width !== undefined ? { width: base.width } : {}),
    ...(base?.height !== undefined ? { height: base.height } : {}),
    ...(base?.fps !== undefined ? { fps: base.fps } : {}),
    scenes,
    ...(base?.audio !== undefined ? { audio: base.audio } : {}),
    ...(base?.templates?.length ? { templates: base.templates } : {}),
    ...(base?.grade !== undefined ? { grade: base.grade } : {}),
  };
}

/**
 * Play the same scene several times.
 *
 * ```ts
 * repeat(chorus, 3);                       // chorus, chorus, chorus
 * repeat(chorus, { times: 3, gap: 1 });    // 1s of black between each
 * ```
 *
 * With `gap`, the repeated scene is copied and the gap is added to its
 * duration rather than inserted as a separate scene, so the scene's background
 * holds through the pause instead of flashing. Pass `{ gap: 0 }` for none.
 *
 * Every repetition shares the same object, which is what `scene()` is for:
 * editing the scene changes all of them. Use a copy (see `variants`) when
 * each repetition needs to differ.
 */
export function repeat(
  input: KinoScene | KinoComposition | CompositionBuilder,
  timesOrOptions: number | { times: number; gap?: number } = 2
): KinoScene[] {
  const { times, gap = 0 } = typeof timesOrOptions === "number" ? { times: timesOrOptions } : timesOrOptions;
  const scenes = scenesOf(input);

  const out: KinoScene[] = [];
  for (let i = 0; i < Math.max(0, Math.floor(times)); i++) {
    for (const s of scenes) {
      out.push(gap > 0 && typeof s.duration === "number" ? { ...s, duration: s.duration + gap } : s);
    }
  }
  return out;
}

/**
 * One scene, several versions — the basis for a verse/chorus structure.
 *
 * ```ts
 * variants({ for: 4, bg: "#111827" }, [
 *   { id: "verse",   elements: elements(text("I")) },
 *   { id: "chorus",  elements: elements(text("We")) },
 * ]);
 * ```
 *
 * Props are the shared scene properties; each entry overrides them and adds
 * elements, so the background and length are written once. An element can also
 * be written directly and is taken as the elements list.
 */
export function variants(
  base: SceneProps,
  each: (Partial<SceneProps> & { elements?: ElementPart })[],
): KinoScene[] {
  return each.map(({ elements: parts, ...overrides }) => {
    const merged = { ...base, ...withoutUndefined(overrides) };
    return scene(merged, elements(parts ?? []));
  });
}

/** Scenes held by anything `merge()` accepts, flattened. */
function scenesOf(input: KinoScene | KinoComposition | CompositionBuilder): KinoScene[] {
  return merge(input).scenes;
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Identity helper for plain-object compositions — gives you type checking and
 * autocomplete without the builder.
 *
 * ```ts
 * export default defineComposition({
 *   width: 1080,
 *   scenes: [{ duration: 5, elements: [{ type: "text", content: "Hi" }] }],
 * });
 * ```
 */
export function defineComposition(composition: KinoComposition): KinoComposition {
  return composition;
}

/** Narrow a builder or plain object to a `KinoComposition`. */
export function toComposition(input: CompositionBuilder | KinoComposition): KinoComposition {
  return input instanceof CompositionBuilder ? input.build() : input;
}
