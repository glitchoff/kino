import type { ImageElement, VideoElement, NormalizedImageElement, NormalizedVideoElement } from "../../types/index.js";
import { formatBasePosition, escapeExpr, normalizeColor } from "../position.js";
import { parseDuration, parsePixels } from "../../normalize/unit-parser.js";

export interface ChromaKeyConfig {
  /** Key colour to remove. `"green"`, `"#00ff00"`, `"0x00ff00"`… Defaults to green. */
  color?: string;
  /** 0–1 similarity: how close to the key colour counts as background. Default 0.01. */
  similarity?: number | string;
  /** 0–1 blend: softens the edge between keyed and kept pixels. Default 0. */
  blend?: number | string;
  /** Removes colour bleed from the key colour on the subject. Default false. */
  despill?: boolean;
}

export interface ChromaKey {
  color: string;
  similarity: number;
  blend: number;
  despill: boolean;
}

const DEFAULT_KEY_COLOR = "#00ff00";
const DEFAULT_SIMILARITY = 0.01;
const DEFAULT_BLEND = 0.0;

function clamp01(value: number | string | undefined, fallback: number): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (n === undefined || Number.isNaN(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

/**
 * Normalises a `chromaKey` element option into a fully-resolved config.
 * Returns `undefined` when the element has no key.
 *
 * FFmpeg's `chromakey`/`colorkey` only key *exact-ish* colour matches, so the
 * defaults are intentionally tight (similarity 0.01). Raise `similarity` for
 * poorly-lit green screens.
 */
export function normalizeChromaKey(key: boolean | ChromaKeyConfig | undefined): ChromaKey | undefined {
  if (!key) return undefined;
  const config: ChromaKeyConfig = key === true ? {} : key;
  return {
    color: config.color ?? DEFAULT_KEY_COLOR,
    similarity: clamp01(config.similarity, DEFAULT_SIMILARITY),
    blend: clamp01(config.blend, DEFAULT_BLEND),
    despill: config.despill ?? false,
  };
}

/**
 * Builds the keying filter string for a chroma-keyed layer.
 * Requires the input to be in RGBA — the caller's scale filter must have
 * emitted `format=rgba` (see `buildMediaScaleFilter`).
 */
export function buildChromaKeyFilter(key: ChromaKey): string {
  const color = normalizeColor(key.color);
  const parts = [`chromakey=color=${color}:similarity=${key.similarity}:blend=${key.blend}`];
  if (key.despill) parts.push(`despill=type=${/green|0x00ff00/i.test(key.color) ? "green" : "blue"}`);
  return parts.join(",");
}

export function buildMediaScaleFilter(elem: ImageElement | VideoElement | NormalizedImageElement | NormalizedVideoElement | any): string {
  const w = parsePixels(elem.width) ?? -1;
  const h = parsePixels(elem.height) ?? -1;
  const fit = elem.fit;
  // Keyed layers must stay RGBA all the way to the overlay or the alpha is
  // lost. The same applies to anything with transparency of its own: a plain
  // `scale=w:h` outputs yuv420p, which has no alpha channel, so a PNG with
  // transparent regions becomes a fully transparent overlay and disappears.
  // Shapes are always transparent around the drawn region.
  const keyed = !!elem.chromaKey || elem.type === "shape" || !!elem.preserveAlpha;

  if (w > 0 && h > 0) {
    if (fit === "cover") {
      const base = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
      return keyed ? `${base},format=rgba` : base;
    }
    if (fit === "contain") {
      return `scale=${w}:${h}:force_original_aspect_ratio=decrease,format=rgba,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`;
    }
  }
  const base = `scale=${w}:${h}`;
  return keyed ? `${base},format=rgba` : base;
}

export interface MediaLayerLike {
  x?: number | string;
  y?: number | string;
  offsetX?: number | string;
  offsetY?: number | string;
  startAt?: number | string;
  startTime?: number;
  duration?: number | string;
}

export interface MediaAnimation {
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
  const startVal = parseDuration(elem.startAt) ?? 0;
  const itemDur = parseDuration(elem.duration);

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
      const e = itemDur !== undefined ? s + itemDur : duration;
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
      const e = itemDur !== undefined ? s + itemDur : duration;
      overlayFilter += `:enable='between(t\\,${s}\\,${e})'`;
    }
    filterComplex.push(`${inPad}${startPad}${overlayFilter}${outPad}`);
    return outPad;
  }
}
