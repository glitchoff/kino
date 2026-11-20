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

/**
 * Whether a scale animation can be expressed with `zoompan`.
 *
 * Returns the rewritten expression, or `undefined` to keep `scale=…:eval=frame`.
 *
 * ffmpeg documents `zoom` as "Range is 1-10" (filters.html §zoompan), so an
 * animation that dips below 1 — `popIn` starts at 0.8, a shrink-out ends at 0 —
 * cannot use it. The bounds are computed from the animation's own `from`/`to`
 * rather than guessed from the compiled string, because a wrong guess would
 * clamp the motion silently instead of failing.
 */
export function zoompanExpression(
  anim: { from?: unknown; to?: unknown; duration?: unknown; delay?: unknown; easing?: unknown; keyframes?: unknown } | undefined,
  fps: number,
  startAt = 0
): string | undefined {
  if (!anim) return undefined;

  // A keyframe track can wander anywhere; only a two-point `from`/`to` ramp has
  // bounds we can prove without evaluating the easing curve.
  if (Array.isArray(anim?.keyframes)) return undefined;

  const from = typeof anim.from === "number" ? anim.from : Number(anim.from);
  const to = typeof anim.to === "number" ? anim.to : Number(anim.to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return undefined;

  // Easing curves overshoot (easeOutBack, easeOutElastic), so the endpoint
  // values alone do not bound the range. Only `linear` is provably monotonic
  // between them.
  const easing = anim.easing ?? "linear";
  if (easing !== "linear") return undefined;

  if (Math.min(from, to) < 1 || Math.max(from, to) > 10) return undefined;

  const delay = parseDuration(anim.delay as string | number | undefined) ?? 0;
  const dur = parseDuration(anim.duration as string | number | undefined) ?? 1;
  const start = startAt + delay;
  // `zoompan` has `on` (output frame index), not `t`. on/fps recovers seconds.
  const p = `min(max(((on/${fps}) - ${start})/${dur}, 0), 1)`;
  return `(${from} + (${to} - ${from})*(${p}))`;
}

/**
 * True when the element is drawn at least as large as the frame it sits on.
 *
 * `zoompan`'s output is fixed at the frame size, so it can only stand in for
 * `scale` when the element already covers the frame — otherwise the zoom would
 * crop a small element rather than grow it.
 */
function coversFrame(elem: MediaLayerLike, frameW: number, frameH: number): boolean {
  const w = parsePixels(elem.width as number | string | undefined) ?? 0;
  const h = parsePixels(elem.height as number | string | undefined) ?? 0;
  return w >= frameW && h >= frameH;
}

export interface MediaLayerLike {
  width?: number | string;
  height?: number | string;
  animation?: { scale?: unknown; opacity?: unknown; x?: unknown; y?: unknown } | any;
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
  lastVideoPad: string,
  /** Frame the element is composited onto, and the rate `zoompan` needs. */
  frame?: { width: number; height: number; fps: number },
  /** True when the layer carries alpha, which `zoompan` would flatten. */
  needsAlpha = false
): string {
  const frameW = frame?.width ?? 0;
  const frameH = frame?.height ?? 0;
  const fps = frame?.fps ?? 30;
  // Opacity is applied by the `geq` pass below; `zoompan` runs before it and
  // would flatten the alpha that pass needs, so the two never combine.
  const opacityAnimated = !!ax.opacity;
  const outPad = `[v_layer_${elemIdx}]`;
  const inPad = lastVideoPad.startsWith("[") ? lastVideoPad : `[${lastVideoPad}]`;
  const startVal = parseDuration(elem.startAt) ?? 0;
  const itemDur = parseDuration(elem.duration);

  if (hasAnimation) {
    let transPad = startPad;

    if (ax.scale) {
      const scaleExpr = `max(0.01,(${ax.scale}))`;
      const np = `[img_scaled_${elemIdx}]`;
      // Both dimensions get the same expression, each clamped to at least 2px.
      // A derived height (`h=-2`) rounds to 0 for wide, thin elements — e.g. a
      // 1100x3 rule at scale 0.01 becomes 11x0, which ffmpeg rejects with
      // "Picture size 11x0 is invalid". Clamping height independently keeps the
      // aspect ratio except at scales where the element is invisible anyway.
      //
      // `zoompan` does the same zoom in one pass instead of a per-frame resample
      // of the whole element: measured 1359 ms vs 3336 ms for 180 frames of a
      // 1080p push. Three things disqualify it, and each would be a silent
      // wrong picture rather than a slow one:
      //
      //   - it **destroys alpha** (verified: an RGBA source comes back opaque),
      //   - its output is fixed at `s=WxH`, so an element smaller than the frame
      //     would be cropped instead of scaled,
      //   - it runs before the `geq` opacity pass, which needs the alpha.
      //
      // Anything failing a check keeps `scale=…:eval=frame`.
      const zoom = zoompanExpression(elem.animation?.scale, fps, startVal);
      const fillsFrame =
        frame !== undefined && coversFrame(elem, frame.width, frame.height);
      if (zoom && !opacityAnimated && !needsAlpha && fillsFrame) {
        filterComplex.push(
          `${transPad}zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${frameW}x${frameH}:fps=${fps}${np}`
        );
      } else {
        filterComplex.push(
          `${transPad}scale=w='max(2,iw*${scaleExpr})':h='max(2,ih*${scaleExpr})':eval=frame${np}`
        );
      }
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
