import type {
  AnimationValue,
  Easing,
  ElementAnimation,
  ImageElement,
  TextElement,
  VideoElement,
} from "./types.js";

export function easingExpression(easing: Easing | undefined, p: string): string {
  switch (easing ?? "linear") {
    case "easeIn":
      return `((${p})*(${p})*(${p}))`;
    case "easeOut":
      return `(1-(1-(${p}))*(1-(${p}))*(1-(${p})))`;
    case "easeInOut":
      return `(3*(${p})*(${p})-2*(${p})*(${p})*(${p}))`;
    default:
      return `(${p})`;
  }
}

export function animationValueExpression(
  anim: AnimationValue,
  startAt: number,
  timeVar: string
): string {
  const start = startAt + (anim.delay ?? 0);
  const p = `min(max((${timeVar} - ${start})/${anim.duration}, 0), 1)`;
  const curve = easingExpression(anim.easing, p);
  return `(${anim.from} + (${anim.to} - ${anim.from})*(${curve}))`;
}

export function buildAnimationExpressions(
  elem: TextElement | ImageElement | VideoElement,
  timeVar: string
): { opacity?: string; tx?: string; ty?: string; scale?: string } {
  const anim = elem.animation;
  if (!anim) return {};
  const startAt = elem.startAt ?? 0;
  const out: { opacity?: string; tx?: string; ty?: string; scale?: string } = {};
  if (anim.opacity) out.opacity = animationValueExpression(anim.opacity, startAt, timeVar);
  if (anim.x) out.tx = animationValueExpression(anim.x, startAt, timeVar);
  if (anim.y) out.ty = animationValueExpression(anim.y, startAt, timeVar);
  if (anim.scale) out.scale = animationValueExpression(anim.scale, startAt, timeVar);
  return out;
}
