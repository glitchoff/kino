import type { BlendMode, ElementMask } from "../../types/elements.js";
import { formatBasePosition, escapeExpr } from "../position.js";
import { parseDuration } from "../../normalize/unit-parser.js";
import type { MediaAnimation } from "./media.js";

/**
 * The ffmpeg `blend` modes kino exposes.
 *
 * This is a deliberate subset of ffmpeg's list: the modes here are the ones
 * people actually reach for on titles and logos. The full set is available by
 * name, but a mode that is not in this union is a typo, not a feature.
 */
export const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "softlight",
  "hardlight",
  "difference",
  "exclusion",
  "darken",
  "lighten",
  "add",
] as const;

export function isBlendMode(value: unknown): value is BlendMode {
  return typeof value === "string" && (BLEND_MODES as readonly string[]).includes(value);
}

/** `normal` is plain alpha compositing, which is what `overlay` already does. */
export function needsBlendPass(mode: BlendMode | undefined): boolean {
  return mode !== undefined && mode !== "normal";
}

export function hasMask(mask: ElementMask | undefined): boolean {
  return mask !== undefined;
}

/**
 * Build a full-frame transparent canvas for one element.
 *
 * `blend` requires both inputs to be the same size *and* pixel format — feeding
 * it a positioned 160×90 element against a 320×180 base fails with "First input
 * link top parameters do not match". So a blended element is first laid onto a
 * transparent full-frame layer at its final position, and it is that layer which
 * blends. Outside the element the layer stays transparent, so the base passes
 * through untouched — blending does not flatten the frame.
 */
function buildTransparentCanvas(
  filterComplex: string[],
  elemIdx: number,
  width: number,
  height: number,
  fps: number,
  duration: number
): string {
  const pad = `[mask_canvas_${elemIdx}]`;
  filterComplex.push(
    `color=c=black@0.0:s=${width}x${height}:r=${fps}:d=${duration},format=rgba,settb=AVTB${pad}`
  );
  return pad;
}

/**
 * Position an element layer on a transparent canvas, honouring animation and
 * timing. Mirrors `applyMediaOverlay` but against a blank canvas rather than the
 * accumulated frame.
 */
function positionOnCanvas(
  filterComplex: string[],
  elemIdx: number,
  elementPad: string,
  canvasPad: string,
  elem: { x?: number | string; y?: number | string; offsetX?: number | string; offsetY?: number | string; startAt?: number | string; duration?: number | string },
  ax: MediaAnimation,
  hasAnimation: boolean,
  duration: number
): string {
  const outPad = `[mask_pos_${elemIdx}]`;
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

  let overlay = `overlay=x='${escapeExpr(ox)}':y='${escapeExpr(oy)}'${hasAnimation ? ":eval=frame" : ""}:format=auto`;
  const hasTiming = elem.startAt !== undefined || elem.duration !== undefined;
  if (hasTiming) {
    const s = startVal;
    const e = itemDur !== undefined ? s + itemDur : duration;
    overlay += `:enable='between(t\\,${s}\\,${e})'`;
  }

  filterComplex.push(`${canvasPad}${elementPad}${overlay}${outPad}`);
  return outPad;
}

/**
 * Apply a mask to a full-frame RGBA layer.
 *
 * Masks are always applied *after* the element is positioned on its canvas, so
 * a mask coordinate means a frame coordinate — a bottom gradient fades the
 * bottom of the frame regardless of where the element sits.
 */
function applyMask(
  filterComplex: string[],
  elemIdx: number,
  layerPad: string,
  mask: ElementMask,
  width: number,
  height: number,
  maskInputIdx: number | undefined
): string {
  let current = layerPad;

  if (mask.shape) {
    const shape = mask.shape;
    const feather = mask.feather ?? 0;

    // The mask is built as its own grayscale image and merged in with
    // `alphamerge`, rather than written into the layer's alpha with `geq`.
    //
    // Writing alpha directly looks simpler and does not work: `boxblur` blurs
    // luma and alpha together, so feathering the edge also smears the element's
    // colour, and converting the result to gray for a blur keeps the *element's*
    // brightness as the mask instead of the shape's.
    let expr: string;
    if (shape === "ellipse") {
      // Normalised ellipse: distance from centre in units of the semi-axes.
      expr = `lte((X-W/2)*(X-W/2)/((W/2)*(W/2))+(Y-H/2)*(Y-H/2)/((H/2)*(H/2))\\,1)`;
    } else if (shape === "rect") {
      expr = `1`;
    } else {
      const dir = mask.direction ?? "down";
      switch (dir) {
        case "up":
          expr = `1-Y/H`;
          break;
        case "left":
          expr = `1-X/W`;
          break;
        case "right":
          expr = `X/W`;
          break;
        default:
          expr = `Y/H`;
      }
    }

    const maskValue = mask.invert ? `(1-(${expr}))` : `(${expr})`;
    const blur = feather > 0 ? `,boxblur=${Math.max(1, Math.round(feather))}:1` : "";
    const maskPad = `[mask_gray_${elemIdx}]`;
    filterComplex.push(
      `color=c=black:s=${width}x${height}:d=1,format=gray,geq=lum='255*${maskValue}'${blur}${maskPad}`
    );

    const merged = `[mask_shape_${elemIdx}]`;
    filterComplex.push(`${current}${maskPad}alphamerge${merged}`);
    current = merged;
  }

  if (mask.src) {
    if (maskInputIdx === undefined) {
      throw new Error("mask.src needs an ffmpeg input; the compiler did not register one.");
    }
    // A luma/alpha matte from a file: scale it to the frame and take its luma.
    const srcPad = `[${maskInputIdx}:v]`;
    const mattePad = `[mask_src_${elemIdx}]`;
    const feather = mask.feather ?? 0;
    const blur = feather > 0 ? `,boxblur=${Math.max(1, Math.round(feather))}:1` : "";
    filterComplex.push(`${srcPad}scale=${width}:${height},format=gray${blur}${mattePad}`);
    const merged = `[mask_src_merged_${elemIdx}]`;
    filterComplex.push(`${current}${mattePad}alphamerge${merged}`);
    current = merged;
  }

  return current;
}

/**
 * Composite one element onto the frame with a blend mode and/or a mask.
 *
 * Returns the new frame pad. The element layer is placed on a transparent
 * full-frame canvas, masked, and then either blended or alpha-composited onto
 * the base.
 */
export function applyBlendAndMask(
  filterComplex: string[],
  elemIdx: number,
  elementPad: string,
  basePad: string,
  /** Set when the element is already full-frame and positioned (e.g. text). */
  alreadyPositioned: boolean,
  elem: {
    x?: number | string;
    y?: number | string;
    offsetX?: number | string;
    offsetY?: number | string;
    startAt?: number | string;
    duration?: number | string;
    blend?: BlendMode;
    mask?: ElementMask;
  },
  ax: MediaAnimation,
  hasAnimation: boolean,
  sceneDuration: number,
  width: number,
  height: number,
  fps: number,
  maskInputIdx?: number
): string {
  const inPad = basePad.startsWith("[") ? basePad : `[${basePad}]`;
  let layer: string;
  if (alreadyPositioned) {
    // `drawtext` has already placed the text at its final coordinates, and the
    // pad is full-frame, so re-positioning it would move it twice.
    layer = elementPad;
  } else {
    const canvas = buildTransparentCanvas(filterComplex, elemIdx, width, height, fps, sceneDuration);
    layer = positionOnCanvas(filterComplex, elemIdx, elementPad, canvas, elem, ax, hasAnimation, sceneDuration);
  }

  if (hasMask(elem.mask)) {
    layer = applyMask(filterComplex, elemIdx, layer, elem.mask!, width, height, maskInputIdx);
  }

  const outPad = `[v_layer_${elemIdx}]`;

  if (needsBlendPass(elem.blend)) {
    // Both sides must agree on format. `rgb24` drops alpha, which is correct
    // here: by the time the frame is blended it is opaque footage, and the
    // transparent canvas has already done its job of keeping the element local.
    const base = `[blend_base_${elemIdx}]`;
    const top = `[blend_top_${elemIdx}]`;
    filterComplex.push(`${inPad}format=rgb24${base}`);
    filterComplex.push(`${layer}format=rgb24${top}`);
    // `blend` emits a format ffmpeg treats as full-range, and handing that
    // straight to the encoder's yuv420p conversion misreads the levels —
    // multiply(0x202060, 0x804020) came out as 0,67,0 instead of 15,8,11.
    // Pinning rgb24 on the way out fixes the range interpretation.
    filterComplex.push(`${base}${top}blend=all_mode=${elem.blend},format=rgb24${outPad}`);
  } else {
    // `normal`: the canvas already carries the element at its final position,
    // so a plain alpha overlay is the whole job.
    filterComplex.push(`${inPad}${layer}overlay=0:0:format=auto${outPad}`);
  }

  return outPad;
}

