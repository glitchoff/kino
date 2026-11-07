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
  | "easeInOutCirc";

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

export interface ElementAnimation {
  opacity?: AnimationValue;
  x?: AnimationValue;
  y?: AnimationValue;
  scale?: AnimationValue;
  /**
   * A step function instead of an interpolation. Used by captions to draw one
   * copy of a line with a different word emphasised as each word is spoken.
   */
  steps?: AnimationKeyframe[];
}
