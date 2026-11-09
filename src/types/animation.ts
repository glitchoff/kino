export type Easing =
  | "linear"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "easeInSine"
  | "easeOutSine"
  | "easeInOutSine"
  | "easeInExpo"
  | "easeOutExpo"
  | "easeInOutExpo"
  | "easeInCirc"
  | "easeOutCirc"
  | "easeInOutCirc"
  | "easeInBack"
  | "easeOutBack"
  | "easeInOutBack"
  | "easeOutElastic"
  | "easeOutBounce";

export interface AnimationValue {
  from: number | string;
  to: number | string;
  duration: number | string;
  delay?: number | string;
  easing?: Easing;
}

/** One step of a stepwise animation: hold `value` from `at` seconds. */
export interface AnimationKeyframe {
  /** Seconds from the element's `startAt`. */
  at: number | string;
  value: number | string;
}

/**
 * One point on an animated curve.
 *
 * `easing` describes the segment *arriving* at this keyframe, so the first
 * keyframe's easing is unused. Omitting it inherits the track's `easing`,
 * defaulting to `easeInOut`.
 */
export interface CurveKeyframe {
  /** Seconds from the element's `startAt`. */
  at: number | string;
  value: number | string;
  easing?: Easing;
}

/**
 * A multi-keyframe animation.
 *
 * `{ from, to, duration }` is sugar for two keyframes and stays the simpler
 * form when there are only two.
 */
export interface KeyframedValue {
  keyframes: CurveKeyframe[];
  /** Easing for keyframes that do not set their own. Default `easeInOut`. */
  easing?: Easing;
}

/** Either form is accepted wherever a value can be animated. */
export type AnimatableValue = AnimationValue | KeyframedValue;

export interface ElementAnimation {
  opacity?: AnimatableValue;
  x?: AnimatableValue;
  y?: AnimatableValue;
  scale?: AnimatableValue;
  /**
   * A step function instead of an interpolation. Used by captions to draw one
   * copy of a line with a different word emphasised as each word is spoken.
   */
  steps?: AnimationKeyframe[];
}
