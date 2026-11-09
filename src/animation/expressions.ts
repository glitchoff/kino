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
    // Overshoot and settle. `c1` is the usual 1.70158.
    case "easeInBack":
      return `(2.70158*(${p})*(${p})*(${p})-1.70158*(${p})*(${p}))`;
    case "easeOutBack":
      return `(1+2.70158*pow(${p}-1,3)+1.70158*pow(${p}-1,2))`;
    case "easeInOutBack":
      return `(if(lt(${p},0.5),pow(2*${p},2)*(3.59488*2*${p}-2.59488)/2,(pow(2*${p}-2,2)*(3.59488*(2*${p}-2)+2.59488)+2)/2))`;
    case "easeOutElastic":
      // A damped sine that starts at 0 and lands exactly on 1.
      return `(if(eq(${p},0),0,if(eq(${p},1),1,pow(2,-10*${p})*sin((${p}*10-0.75)*2*PI/3)+1)))`;
    case "easeOutBounce":
      // Piecewise parabola, the standard Penner bounce.
      return `(if(lt(${p},1/2.75),7.5625*${p}*${p},` +
        `if(lt(${p},2/2.75),7.5625*pow(${p}-1.5/2.75,2)+0.75,` +
        `if(lt(${p},2.5/2.75),7.5625*pow(${p}-2.25/2.75,2)+0.9375,` +
        `7.5625*pow(${p}-2.625/2.75,2)+0.984375))))`;
    default:
      return `(${p})`;
  }
}

export function animationValueExpression(
  anim: NormalizedAnimationValue | any,
  startAt: number,
  timeVar: string
): string {
  // A keyframe list compiles to a nested `if` chain over `t`; `{ from, to }` is
  // sugar for two keyframes and keeps its existing (simpler) expression.
  if (Array.isArray(anim?.keyframes)) {
    return keyframeExpression(anim, startAt, timeVar);
  }

  const animDelay = parseDuration(anim.delay) ?? 0;
  const animDur = parseDuration(anim.duration) ?? 1;
  const from = typeof anim.from === "number" ? anim.from : (parseVolume(anim.from) ?? parsePixels(anim.from) ?? 0);
  const to = typeof anim.to === "number" ? anim.to : (parseVolume(anim.to) ?? parsePixels(anim.to) ?? 0);

  const start = startAt + animDelay;
  const p = `min(max((${timeVar} - ${start})/${animDur}, 0), 1)`;
  const curve = easingExpression(anim.easing, p);
  return `(${from} + (${to} - ${from})*(${curve}))`;
}

function toNumber(v: number | string | undefined): number {
  if (typeof v === "number") return v;
  if (v === undefined) return 0;
  return parseVolume(v) ?? parsePixels(v) ?? 0;
}

/**
 * Compile a keyframe list to a single ffmpeg expression.
 *
 * The chain is built back-to-front: the last keyframe is the fallback, and each
 * earlier segment wraps the next in `if(lt(t, end), segment, rest)`. Two
 * keyframes produce the same expression shape as `{ from, to }`.
 */
export function keyframeExpression(
  anim: { keyframes: { at: number | string; value: number | string; easing?: Easing }[]; easing?: Easing },
  startAt: number,
  timeVar: string
): string {
  const kfs = anim.keyframes
    .map((k) => ({ at: parseDuration(k.at) ?? 0, value: toNumber(k.value), easing: k.easing }))
    .sort((a, b) => a.at - b.at);

  if (kfs.length === 0) return "0";
  if (kfs.length === 1) return String(kfs[0].value);

  const defaultEasing = anim.easing ?? "easeInOut";

  // Before the first keyframe: hold its value.
  let expr = String(kfs[kfs.length - 1].value);

  for (let i = kfs.length - 2; i >= 0; i--) {
    const a = kfs[i];
    const b = kfs[i + 1];
    const span = b.at - a.at;
    if (span <= 0) {
      // Coincident keyframes: the later one wins, no interpolation.
      expr = `(if(lt(${timeVar},${startAt + b.at}),${a.value},${expr}))`;
      continue;
    }
    // `easing` on a keyframe describes the segment arriving at it.
    const easing = b.easing ?? defaultEasing;
    const p = `min(max((${timeVar} - ${startAt + a.at})/${span},0),1)`;
    const curve = easingExpression(easing, p);
    const seg = `(${a.value} + (${b.value} - ${a.value})*(${curve}))`;
    expr = `(if(lt(${timeVar},${startAt + b.at}),${seg},${expr}))`;
  }

  return expr;
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
