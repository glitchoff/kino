import type {
  Easing,
  NormalizedAnimationValue,
  NormalizedElement,
} from "../types/index.js";
import { parseDuration, parsePixels, parseVolume } from "../normalize/unit-parser.js";

export function easingExpression(easing: Easing | undefined, p: string): string {
  switch (easing ?? "linear") {
    case "easeIn":
      return `((${p})*(${p})*(${p}))`;
    case "easeOut":
      return `(1-(1-(${p}))*(1-(${p}))*(1-(${p})))`;
    case "easeInOut":
      return `(3*(${p})*(${p})-2*(${p})*(${p})*(${p}))`;
    case "easeInSine":
      return `(1-cos(${p}*PI/2))`;
    case "easeOutSine":
      return `sin(${p}*PI/2)`;
    case "easeInOutSine":
      return `((1-cos(${p}*PI))/2)`;
    case "easeInExpo":
      return `(if(eq(${p},0),0,pow(2,10*${p}-10)))`;
    case "easeOutExpo":
      return `(if(eq(${p},1),1,1-pow(2,-10*${p})))`;
    case "easeInOutExpo":
      return `(if(eq(${p},0),0,if(eq(${p},1),1,if(lt(${p},0.5),pow(2,20*${p}-10)/2,(2-pow(2,-20*${p}+10))/2))))`;
    case "easeInCirc":
      return `(1-sqrt(1-${p}*${p}))`;
    case "easeOutCirc":
      return `(sqrt(1-(1-${p})*(1-${p})))`;
    case "easeInOutCirc":
      return `(if(lt(${p},0.5),(1-sqrt(1-4*${p}*${p}))/2,(sqrt(1-(2-2*${p})*(2-2*${p}))+1)/2))`;
    default:
      return `(${p})`;
  }
}

export function animationValueExpression(
  anim: NormalizedAnimationValue | any,
  startAt: number,
  timeVar: string
): string {
  const animDelay = parseDuration(anim.delay) ?? 0;
  const animDur = parseDuration(anim.duration) ?? 1;
  const from = typeof anim.from === "number" ? anim.from : (parseVolume(anim.from) ?? parsePixels(anim.from) ?? 0);
  const to = typeof anim.to === "number" ? anim.to : (parseVolume(anim.to) ?? parsePixels(anim.to) ?? 0);

  const start = startAt + animDelay;
  const p = `min(max((${timeVar} - ${start})/${animDur}, 0), 1)`;
  const curve = easingExpression(anim.easing, p);
  return `(${from} + (${to} - ${from})*(${curve}))`;
}

export function buildAnimationExpressions(
  elem: NormalizedElement | any,
  timeVar: string
): { opacity?: string; tx?: string; ty?: string; scale?: string } {
  const anim = elem.animation;
  if (!anim) return {};
  const startAt = parseDuration(elem.startAt) ?? 0;
  const out: { opacity?: string; tx?: string; ty?: string; scale?: string } = {};
  if (anim.opacity) out.opacity = animationValueExpression(anim.opacity, startAt, timeVar);
  if (anim.x) out.tx = animationValueExpression(anim.x, startAt, timeVar);
  if (anim.y) out.ty = animationValueExpression(anim.y, startAt, timeVar);
  if (anim.scale) out.scale = animationValueExpression(anim.scale, startAt, timeVar);
  return out;
}
