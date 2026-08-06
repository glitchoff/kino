import type { ImageElement, VideoElement } from "../../types/index.js";
import { buildAnimationExpressions } from "../../animation/index.js";
import { formatBasePosition, escapeExpr } from "../position.js";

export function buildMediaScaleFilter(elem: ImageElement | VideoElement): string {
  const w = elem.width ?? -1;
  const h = elem.height ?? -1;
  const fit = elem.fit;

  if (w > 0 && h > 0) {
    if (fit === "cover") {
      return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
    }
    if (fit === "contain") {
      return `scale=${w}:${h}:force_original_aspect_ratio=decrease,format=rgba,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`;
    }
  }
  return `scale=${w}:${h}`;
}

interface MediaLayerLike {
  x?: number | string;
  y?: number | string;
  offsetX?: number;
  offsetY?: number;
  startAt?: number;
  startTime?: number;
  duration?: number;
}

interface MediaAnimation {
  opacity?: string;
  tx?: string;
  ty?: string;
  scale?: string;
}

export function applyMediaOverlay(
  filterComplex: string[],
  elemIdx: number,
  startPad: string,
  elem: MediaLayerLike,
  ax: MediaAnimation,
  hasAnimation: boolean,
  duration: number,
  lastVideoPad: string
): string {
  const outPad = `[v_layer_${elemIdx}]`;
  const inPad = lastVideoPad.startsWith("[") ? lastVideoPad : `[${lastVideoPad}]`;
  const startVal = elem.startAt ?? 0;

  if (hasAnimation) {
    let transPad = startPad;

    if (ax.scale) {
      const scaleExpr = `max(0.01,(${ax.scale}))`;
      const np = `[img_scaled_${elemIdx}]`;
      filterComplex.push(`${transPad}scale=w='max(2,iw*${scaleExpr})':h=-2:eval=frame${np}`);
      transPad = np;
    }

    if (ax.opacity) {
      const np = `[img_alpha_${elemIdx}]`;
      const oExpr = ax.opacity.replace(/\bt\b/g, "T").replace(/,/g, "\\,");
      filterComplex.push(
        `${transPad}format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*(${oExpr})'${np}`
      );
      transPad = np;
    }

    const staticX = formatBasePosition(elem.x, elem.offsetX, "(main_w-overlay_w)/2");
    const staticY = formatBasePosition(elem.y, elem.offsetY, "(main_h-overlay_h)/2");

    let ox = staticX;
    let oy = staticY;
    if (ax.tx) ox = `(${staticX}) + (${ax.tx})`;
    if (ax.ty) oy = `(${staticY}) + (${ax.ty})`;
    if (ax.scale) {
      const scaleExpr = `max(0.01,(${ax.scale}))`;
      ox += ` - (overlay_w*(1-(1/${scaleExpr})))/2`;
      oy += ` - (overlay_h*(1-(1/${scaleExpr})))/2`;
    }

    let overlayFilter = `overlay=x='${escapeExpr(ox)}':y='${escapeExpr(oy)}':eval=frame`;
    const hasTiming = elem.startAt !== undefined || elem.duration !== undefined;
    if (hasTiming) {
      const s = startVal;
      const e = elem.duration !== undefined ? s + elem.duration : duration;
      overlayFilter += `:enable='between(t\\,${s}\\,${e})'`;
    }
    filterComplex.push(`${inPad}${transPad}${overlayFilter}${outPad}`);
    return outPad;
  } else {
    const xExpr = formatBasePosition(elem.x, elem.offsetX, "(main_w-overlay_w)/2");
    const yExpr = formatBasePosition(elem.y, elem.offsetY, "(main_h-overlay_h)/2");
    let overlayFilter = `overlay=x=${xExpr}:y=${yExpr}`;
    const hasTiming = elem.startAt !== undefined || elem.duration !== undefined;
    if (hasTiming) {
      const s = startVal;
      const e = elem.duration !== undefined ? s + elem.duration : duration;
      overlayFilter += `:enable='between(t\\,${s}\\,${e})'`;
    }
    filterComplex.push(`${inPad}${startPad}${overlayFilter}${outPad}`);
    return outPad;
  }
}
