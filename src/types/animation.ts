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
  from: number;
  to: number;
  duration: number;
  delay?: number;
  easing?: Easing;
}

export interface ElementAnimation {
  opacity?: AnimationValue;
  x?: AnimationValue;
  y?: AnimationValue;
  scale?: AnimationValue;
}
