import { existsSync } from "node:fs";
import type {
  KinoComposition,
  NormalizedComposition,
  NormalizedElement,
  NormalizedTextElement,
  NormalizedImageElement,
  NormalizedVideoElement,
  NormalizedHtmlElement,
} from "../types/index.js";
import { normalizeComposition } from "../normalize/composition.js";
import { toComposition, type CompositionBuilder } from "../builder/index.js";
import { validateComposition, KinoValidationError } from "../validate/index.js";
import { measureText, type MeasureSource } from "../measure/index.js";
import { wrapText, estimateTextWidth } from "../normalize/element.js";
import {
  formatTextBasePosition,
  formatPosition,
} from "../pipeline/position.js";

/** A resolved rectangle in frame pixels. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type IssueSeverity = "error" | "warning";

/** A layout problem that would otherwise only show up in a render. */
export interface InspectIssue {
  severity: IssueSeverity;
  /** Stable identifier, e.g. `element-outside-frame`. */
  code: string;
  message: string;
  sceneId?: string;
  elementId?: string;
}

export interface InspectedElement {
  id?: string;
  type: NormalizedElement["type"];
  /** Bounding box in frame pixels, when it can be resolved. */
  box?: Box;
  /** What the author wrote, before unit resolution. */
  position: { x?: number | string; y?: number | string };
  /** Element-local start and duration in seconds. */
  startAt: number;
  duration: number;
  /** Absolute start in the composition, in seconds. */
  start: number;
  /** Absolute end in the composition, in seconds. */
  end: number;
  /** For text: measured width of the widest line, and how many lines it wrapped to. */
  text?: { lines: number; widestLine: number; measured: MeasureSource };
  /** For media: the source path, and whether it was found on disk. */
  src?: { path: string; exists: boolean | null };
}

export interface InspectedScene {
  id: string;
  start: number;
  duration: number;
  transition?: { type: string; duration: number };
  elements: InspectedElement[];
}

export interface InspectReport {
  width: number;
  height: number;
  fps: number;
  duration: number;
  scenes: InspectedScene[];
  issues: InspectIssue[];
}

export interface InspectOptions {
  /**
   * Override the font used to measure text. Defaults to the bundled Inter,
   * which is what the renderer draws with.
   */
  fontFile?: string;
  /**
   * @deprecated Ignored. Text is measured by reading the font file, which is
   * synchronous and needs no ffmpeg. Kept so existing calls still typecheck.
   */
  measure?: boolean;
}

/**
 * Evaluate a drawtext position expression to frame pixels.
 *
 * Text positions come back as strings like `((h-text_h)/2)+(240)`. Inspect
 * evaluates the same grammar the compiler emits so the report agrees with the
 * render rather than approximating the units a second time.
 */
function evalExpr(
  expr: string,
  frame: { w: number; h: number; textW: number; textH: number }
): number | undefined {
  let i = 0;
  const s = expr.replace(/\s+/g, "");

  const vars: Record<string, number> = {
    w: frame.w,
    h: frame.h,
    main_w: frame.w,
    main_h: frame.h,
    text_w: frame.textW,
    text_h: frame.textH,
    overlay_w: frame.textW,
    overlay_h: frame.textH,
  };

  function parseExpr(): number | undefined {
    let v = parseTerm();
    if (v === undefined) return undefined;
    while (s[i] === "+" || s[i] === "-") {
      const op = s[i++];
      const r = parseTerm();
      if (r === undefined) return undefined;
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }

  function parseTerm(): number | undefined {
    let v = parseFactor();
    if (v === undefined) return undefined;
    while (s[i] === "*" || s[i] === "/") {
      const op = s[i++];
      const r = parseFactor();
      if (r === undefined) return undefined;
      if (op === "/" && r === 0) return undefined;
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }

  function parseFactor(): number | undefined {
    if (s[i] === "-") {
      i++;
      const v = parseFactor();
      return v === undefined ? undefined : -v;
    }
    if (s[i] === "+") {
      i++;
      return parseFactor();
    }
    if (s[i] === "(") {
      i++;
      const v = parseExpr();
      if (s[i] === ")") i++;
      return v;
    }
    const m = /^[0-9]*\.?[0-9]+/.exec(s.slice(i));
    if (m) {
      i += m[0].length;
      return parseFloat(m[0]);
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (name) {
      i += name[0].length;
      return vars[name[0]];
    }
    return undefined;
  }

  const v = parseExpr();
  return v === undefined || !Number.isFinite(v) ? undefined : v;
}

const isRemote = (src: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(src) || src.startsWith("data:");

function textBlock(
  el: NormalizedTextElement,
  frame: { w: number; h: number }
): { lines: string[]; widest: number; lineHeight: number; fontSize: number; maxWidth?: number } {
  const fontSize = el.fontSize ?? 48;
  const maxWidth = el.maxWidth;
  const wrapped = wrapText(el.content, fontSize, maxWidth);
  const lines = wrapped.split("\n");
  const lineHeight = (el.lineHeight ?? 1.2) * fontSize;
  const widest = Math.max(0, ...lines.map((l) => estimateTextWidth(l, fontSize)));
  return { lines, widest, lineHeight, fontSize, maxWidth };
}

/**
 * Describe a composition without rendering it.
 *
 * Returns scene and element geometry in frame pixels, plus a list of layout
 * problems: elements outside the frame, elements that outlive their scene,
 * text that is wider than the frame, transitions longer than the scenes they
 * join, and missing media files.
 *
 * Text is measured by reading advance widths out of the font file — the same
 * number drawtext uses — so the report is synchronous and needs no ffmpeg.
 */
export function inspect(
  input: KinoComposition | CompositionBuilder,
  options: InspectOptions = {}
): InspectReport {
  const composition = toComposition(input);

  try {
    validateComposition(composition);
  } catch (err) {
    if (err instanceof KinoValidationError) {
      // A schema error means geometry cannot be trusted; report it instead of
      // returning numbers for a composition that would not compile.
      return {
        width: typeof composition.width === "number" ? composition.width : 0,
        height: typeof composition.height === "number" ? composition.height : 0,
        fps: typeof composition.fps === "number" ? composition.fps : 30,
        duration: 0,
        scenes: [],
        issues: err.issues.map((issue) => ({
          severity: "error" as const,
          code: "invalid-composition",
          message: `${issue.path}: ${issue.message}`,
        })),
      };
    }
    throw err;
  }

  const norm: NormalizedComposition = normalizeComposition(composition);
  const issues: InspectIssue[] = [];

  const measurements = new Map<NormalizedTextElement, { widest: number; lines: number; source: MeasureSource }>();
  const pending: { el: NormalizedTextElement; lines: string[]; fontSize: number; est: number }[] = [];
  for (const scene of norm.scenes) {
    for (const el of scene.elements) {
      if (el.type !== "text") continue;
      const block = textBlock(el, { w: norm.width, h: norm.height });
      pending.push({ el, lines: block.lines, fontSize: block.fontSize, est: block.widest });
    }
  }

  // Each element's widest line, measured from the font. Cheap enough to do for
  // every line rather than guessing which one is widest.
  for (const p of pending) {
    let widest = 0;
    let source: MeasureSource = "font";
    for (const line of p.lines) {
      const m = measureText(line, { fontSize: p.fontSize, fontFile: options.fontFile });
      if (m.width > widest) widest = m.width;
      if (m.source === "estimate") source = "estimate";
    }
    // An element with no text at all still has a line; fall back to the
    // estimator's guess only when measurement produced nothing.
    measurements.set(p.el, {
      widest: widest || p.est,
      lines: p.lines.length,
      source: widest ? source : "estimate",
    });
  }

  const scenes: InspectedScene[] = norm.scenes.map((scene) => {
    const elements = scene.elements.map((el) => inspectElement(el, scene, norm, measurements, issues));
    return {
      id: scene.id,
      start: scene.startTime,
      duration: scene.duration,
      transition: scene.transition
        ? { type: scene.transition.type, duration: scene.transition.duration }
        : undefined,
      elements,
    };
  });

  // Transitions longer than either scene they join cannot complete.
  for (let i = 0; i < norm.scenes.length; i++) {
    const scene = norm.scenes[i];
    if (!scene.transition) continue;
    const prev = norm.scenes[i - 1];
    if (scene.transition.duration > scene.duration) {
      issues.push({
        severity: "error",
        code: "transition-longer-than-scene",
        message: `Transition of ${scene.transition.duration}s is longer than scene '${scene.id}' (${scene.duration}s).`,
        sceneId: scene.id,
      });
    }
    if (prev && scene.transition.duration > prev.duration) {
      issues.push({
        severity: "warning",
        code: "transition-longer-than-previous",
        message: `Transition of ${scene.transition.duration}s is longer than the preceding scene '${prev.id}' (${prev.duration}s).`,
        sceneId: scene.id,
      });
    }
  }

  // Elements that collide inside the same scene, which is the mistake agents
  // make most often when laying out text and images.
  for (const scene of scenes) {
    const boxed = scene.elements.filter((e) => e.box && e.type !== "video");
    for (let i = 0; i < boxed.length; i++) {
      for (let j = i + 1; j < boxed.length; j++) {
        const a = boxed[i].box!;
        const b = boxed[j].box!;
        const overlapW = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapH = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (overlapW > 1 && overlapH > 1) {
          issues.push({
            severity: "warning",
            code: "element-overlap",
            message: `${boxed[i].type} element${boxed[i].id ? ` '${boxed[i].id}'` : ""} overlaps ${boxed[j].type} element${boxed[j].id ? ` '${boxed[j].id}'` : ""} by ${Math.round(overlapW)}×${Math.round(overlapH)}px.`,
            sceneId: scene.id,
            elementId: boxed[i].id,
          });
        }
      }
    }
  }

  return {
    width: norm.width,
    height: norm.height,
    fps: norm.fps,
    duration: norm.duration,
    scenes,
    issues,
  };
}
function inspectElement(
  el: NormalizedElement,
  scene: { id: string; duration: number; startTime: number },
  norm: NormalizedComposition,
  measurements: Map<NormalizedTextElement, { widest: number; lines: number; source: MeasureSource }>,
  issues: InspectIssue[]
): InspectedElement {
  const frame = { w: norm.width, h: norm.height };
  const start = scene.startTime + el.startAt;
  const duration = el.duration ?? scene.duration;
  const end = start + duration;

  const result: InspectedElement = {
    id: el.id,
    type: el.type,
    position: { x: el.x, y: el.y },
    startAt: el.startAt,
    duration,
    start,
    end,
  };

  const push = (severity: IssueSeverity, code: string, message: string) => {
    issues.push({ severity, code, message, sceneId: scene.id, elementId: el.id });
  };

  if (el.startAt + duration > scene.duration + 1e-6) {
    push(
      "warning",
      "element-outlives-scene",
      `Element ends ${(el.startAt + duration - scene.duration).toFixed(2)}s after scene '${scene.id}' and will be cut off.`
    );
  }

  if (el.type === "text") {
    const text = el as NormalizedTextElement;
    const block = textBlock(text, frame);
    const m = measurements.get(text);
    const widest = m?.widest ?? block.widest;
    result.text = { lines: m?.lines ?? block.lines.length, widestLine: Math.round(widest), measured: m?.source ?? "estimate" };

    // Text height: drawtext uses roughly fontSize * 1.2 per line.
    const textH = block.lines.length * block.lineHeight;
    const xExpr = formatTextBasePosition(text.x, text.offsetX, "(w-text_w)/2");
    const yExpr = formatTextBasePosition(text.y, text.offsetY, "(h-text_h)/2");
    const x = evalExpr(xExpr, { ...frame, textW: widest, textH });
    const y = evalExpr(yExpr, { ...frame, textW: widest, textH });

    if (x !== undefined && y !== undefined) {
      // `formatTextBasePosition` emits drawtext's own expression, and drawtext's
      // x/y are the top-left of the text box in every alignment — `(w-text_w)/2`
      // already centres it. Subtracting half the width again put centred text
      // 55px left of where it renders.
      result.box = { x, y, width: widest, height: textH };
    }

    if (widest > frame.w) {
      push(
        "error",
        "text-wider-than-frame",
        `Text is ${Math.round(widest)}px wide, wider than the ${frame.w}px frame.`
      );
    } else if (result.box) {
      if (result.box.x < -0.5 || result.box.x + result.box.width > frame.w + 0.5) {
        push(
          "warning",
          "text-outside-frame",
          `Text box spans x=${Math.round(result.box.x)}…${Math.round(result.box.x + result.box.width)}, outside the ${frame.w}px frame.`
        );
      }
      if (result.box.y < -0.5 || result.box.y + result.box.height > frame.h + 0.5) {
        push(
          "warning",
          "text-outside-frame",
          `Text box spans y=${Math.round(result.box.y)}…${Math.round(result.box.y + result.box.height)}, outside the ${frame.h}px frame.`
        );
      }
    }
    return result;
  }

  // Media and HTML elements: width/height are explicit, so the box is a
  // translation of the position.
  const sized = el as NormalizedImageElement | NormalizedVideoElement | NormalizedHtmlElement;
  const width = sized.width ?? frame.w;
  const height = sized.height ?? frame.h;
  const x = evalExpr(formatPosition(sized.x, "(main_w-overlay_w)/2"), { ...frame, textW: width, textH: height });
  const y = evalExpr(formatPosition(sized.y, "(main_h-overlay_h)/2"), { ...frame, textW: width, textH: height });
  if (x !== undefined && y !== undefined) {
    result.box = { x, y, width, height };
    if (x < -0.5 || y < -0.5 || x + width > frame.w + 0.5 || y + height > frame.h + 0.5) {
      push("warning", "element-outside-frame", `${el.type} box extends outside the frame.`);
    }
  }

  if (el.type === "image" || el.type === "video") {
    const src = (el as NormalizedImageElement | NormalizedVideoElement).src;
    const exists = isRemote(src) ? null : existsSync(src);
    result.src = { path: src, exists };
    if (exists === false) {
      push("error", "missing-source", `Source not found: ${src}`);
    }
  }

  return result;
}
