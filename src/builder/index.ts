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
} from "../types/composition.js";
import type {
  AudioTrack,
} from "../types/audio.js";
import type { BackgroundInput } from "../types/background.js";
import type {
  ElementInput,
  TextElement,
  ImageElement,
  HtmlElement,
  VideoElement,
} from "../types/elements.js";
import type { AnimationValue, Easing, ElementAnimation } from "../types/animation.js";
import type { KinoTemplate } from "../types/template.js";

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
}

export interface VideoOptions extends MediaOptions {
  trimStart?: number | string;
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
  const { width, height, fit } = options;
  return {
    type: "image",
    src,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(fit !== undefined ? { fit } : {}),
    ...baseFrom(options),
  } as ImageElement;
}

export function video(src: string, options: VideoOptions = {}): VideoElement {
  const { width, height, fit, trimStart, loop, volume } = options;
  return {
    type: "video",
    src,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(fit !== undefined ? { fit } : {}),
    ...(trimStart !== undefined ? { trimStart } : {}),
    ...(loop !== undefined ? { loop } : {}),
    ...(volume !== undefined ? { volume } : {}),
    ...baseFrom(options),
  } as VideoElement;
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
// Scene builder
// ---------------------------------------------------------------------------

export interface SceneOptions {
  id?: string;
  duration: number | string;
  background?: BackgroundInput;
  transition?: KinoTransitionType | KinoTransition;
}

export class SceneBuilder {
  private readonly elements: ElementInput[] = [];

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
}

type SceneCallback = (scene: SceneBuilder) => void | SceneBuilder;

export class CompositionBuilder {
  private readonly scenes: KinoScene[] = [];
  private readonly templates: KinoTemplate[] = [];
  private audioTracks: AudioTrack | AudioTrack[] | undefined = undefined;

  constructor(private readonly options: CompositionOptions = {}) {
    this.templates = options.templates ? [...options.templates] : [];
    this.audioTracks = options.audio;
  }

  /**
   * Add a scene. The callback receives a `SceneBuilder` so you can chain
   * `.text(...)`; omit it for an empty scene.
   */
  scene(options: SceneOptions, build?: SceneCallback): this {
    const scene = new SceneBuilder(options);
    if (build) build(scene);
    this.scenes.push(scene.build());
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

  build(): KinoComposition {
    return {
      ...(this.options.width !== undefined ? { width: this.options.width } : {}),
      ...(this.options.height !== undefined ? { height: this.options.height } : {}),
      ...(this.options.fps !== undefined ? { fps: this.options.fps } : {}),
      scenes: this.scenes,
      ...(this.audioTracks !== undefined ? { audio: this.audioTracks } : {}),
      ...(this.templates.length ? { templates: this.templates } : {}),
    };
  }
}

/** Start a new composition. Chain `.scene(...)` then `.build()`. */
export function composition(options: CompositionOptions = {}): CompositionBuilder {
  return new CompositionBuilder(options);
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
