import { formatBasePosition, escapeExpr } from "../position.js";
import { parseDuration } from "../../normalize/unit-parser.js";
import type { MediaAnimation } from "./media.js";

/** Resolved motion-blur settings. */
export interface MotionBlur {
  /** Sub-frame samples to average. More is smoother and more expensive. */
  samples: number;
  /** Portion of a frame the shutter is open for, 0–1. `180°` is `0.5`. */
  shutter: number;
}

/**
 * Normalise the user-facing `motionBlur` option.
 *
 * Accepts a bare number (sample count, with the film-standard 180° shutter) or
 * `{ samples, shutter }`. Returns `undefined` when the element should not be
 * blurred, so callers can keep the cheap single-pass path.
 */
export function resolveMotionBlur(
  value: number | { samples?: number; shutter?: number } | undefined
): MotionBlur | undefined {
  if (value === undefined) return undefined;
  const raw = typeof value === "number" ? { samples: value } : value;
  const samples = Math.round(raw.samples ?? 4);
  if (!Number.isFinite(samples) || samples < 2) return undefined;
  // Beyond 16 the samples overlap heavily and the cost stops buying anything.
  const clamped = Math.min(16, samples);
  const shutter = raw.shutter ?? 0.5;
  return { samples: clamped, shutter: Math.min(1, Math.max(0, shutter)) };
}

/** A shutter angle in degrees, the convention cinematographers use. */
export function shutterFromDegrees(degrees: number): number {
  return Math.min(1, Math.max(0, degrees / 360));
}

/**
 * Build a motion-blurred element layer.
 *
 * The element is placed on its own transparent canvas as usual, and then
 * `tmix` averages the last N frames of *that layer*. This is the key point the
 * ticket got wrong: `tmix` is the wrong tool on the **whole frame** — it would
 * smear the background and leave trails behind everything — but on the
 * element's isolated layer there is nothing else in the picture, so averaging
 * successive frames of it is exactly a shutter.
 *
 * This is also far cheaper than the alternative of drawing the element N times
 * at sub-frame offsets and combining the results: one overlay plus one `tmix`,
 * and `tmix` is a per-pixel running average with no extra decode. Attempts to
 * combine N canvases with chained `blend` filters were abandoned — ffmpeg
 * produces a full-frame smear past two RGBA inputs, and `mix` averages alpha as
 * well as colour, which makes the element translucent instead of smeared.
 *
 * The cost is a fixed delay of `samples - 1` frames at the start, which shows
 * as a brief fade-in of the blurred element. For a moving element that is
 * invisible; for one that starts stationary it reads as a soft entrance.
 */
export function buildMotionBlurLayer(
  filterComplex: string[],
  elemIdx: number,
  elementPad: string,
  basePad: string,
  elem: {
    x?: number | string;
    y?: number | string;
    offsetX?: number | string;
    offsetY?: number | string;
    startAt?: number | string;
    duration?: number | string;
  },
  ax: MediaAnimation,
  hasAnimation: boolean,
  sceneDuration: number,
  width: number,
  height: number,
  fps: number,
  blur: MotionBlur
): string {
  const startVal = parseDuration(elem.startAt) ?? 0;
  const itemDur = parseDuration(elem.duration);
  const staticX = formatBasePosition(elem.x, elem.offsetX, "(main_w-overlay_w)/2");
  const staticY = formatBasePosition(elem.y, elem.offsetY, "(main_h-overlay_h)/2");

  let ox = staticX;
  let oy = staticY;
  if (hasAnimation) {
    if (ax.tx) ox = `(${staticX}) + (${ax.tx})`;
    if (ax.ty) oy = `(${staticY}) + (${ax.ty})`;
    if (ax.scale) {
      const scaleExpr = `max(0.01,(${ax.scale}))`;
      ox += ` - (overlay_w*(1-(1/${scaleExpr})))/2`;
      oy += ` - (overlay_h*(1-(1/${scaleExpr})))/2`;
    }
  }

  const canvasSource = basePad.startsWith("[") ? basePad : `[${basePad}]`;
  const canvas = `[mb_canvas_${elemIdx}]`;
  filterComplex.push(`${canvasSource}format=rgba,settb=AVTB,trim=duration=${sceneDuration}${canvas}`);

  const hasTiming = elem.startAt !== undefined || elem.duration !== undefined;
  const enable = hasTiming
    ? `:enable='between(t\\,${startVal}\\,${itemDur !== undefined ? startVal + itemDur : sceneDuration})'`
    : "";

  const layer = `[mb_layer_${elemIdx}]`;
  filterComplex.push(
    `${canvas}${elementPad}overlay=x='${escapeExpr(ox)}':y='${escapeExpr(oy)}'${hasAnimation ? ":eval=frame" : ""}:format=auto${enable}${layer}`
  );

  // `shutter` maps to how many frames the running average spans: a 180° shutter
  // exposes for half a frame, so it should average half as many frames as there
  // are samples. Keep at least 2, or `tmix` does nothing.
  const frames = Math.max(2, Math.round(blur.samples * blur.shutter * 2));
  const outPad = `[mb_blurred_${elemIdx}]`;
  // `weights` left unset means every frame counts equally, which is the uniform
  // exposure a real shutter gives.
  filterComplex.push(`${layer}tmix=frames=${frames}${outPad}`);

  return outPad;
}
