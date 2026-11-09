import type {
  NormalizedElement,
  NormalizedTextElement,
  NormalizedImageElement,
  NormalizedHtmlElement,
  NormalizedVideoElement,
  NormalizedShapeElement,
} from "../types/normalized.js";
import { normalizeChromaKey } from "../pipeline/elements/media.js";
import {
  parseDuration,
  parseLineHeight,
  parsePixels,
  parseScale,
  parseVolume,
} from "./unit-parser.js";

function getCharWidth(char: string, fontSize: number): number {
  if ("WwM@#%&".includes(char)) return fontSize * 0.8;
  if ("ilmI'|!.,:;()[]{}t-`".includes(char)) return fontSize * 0.28;
  if (char >= "A" && char <= "Z") return fontSize * 0.65;
  if (char === " ") return fontSize * 0.3;
  return fontSize * 0.52;
}

export function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of text) {
    width += getCharWidth(ch, fontSize);
  }
  return width;
}

export function wrapText(content: string, fontSize: number, maxWidth?: number): string {
  if (!maxWidth || maxWidth <= 0 || !content) return content;

  const existingLines = content.split("\n");
  const wrappedLines: string[] = [];

  for (const line of existingLines) {
    if (estimateTextWidth(line, fontSize) <= maxWidth) {
      wrappedLines.push(line);
      continue;
    }
    const words = line.split(" ");
    let currentLine = "";
    for (const word of words) {
      if (!currentLine) {
        currentLine = word;
      } else {
        const testLine = `${currentLine} ${word}`;
        if (estimateTextWidth(testLine, fontSize) <= maxWidth) {
          currentLine = testLine;
        } else {
          wrappedLines.push(currentLine);
          currentLine = word;
        }
      }
    }
    if (currentLine) wrappedLines.push(currentLine);
  }

  return wrappedLines.join("\n");
}

function normalizeAnimation(anim: any, sceneDuration?: number): any {
  if (!anim) return undefined;
  const normalized: any = {};
  const channels = ["opacity", "x", "y", "scale"] as const;
  for (const ch of channels) {
    if (!anim[ch]) continue;
    const channelVal = anim[ch];
    const duration = parseDuration(channelVal.duration, sceneDuration) ?? 0;
    const delay = parseDuration(channelVal.delay, sceneDuration);
    let from = channelVal.from;
    let to = channelVal.to;
    if (ch === "opacity") {
      from = parseVolume(from) ?? (typeof from === "number" ? from : 0);
      to = parseVolume(to) ?? (typeof to === "number" ? to : 1);
    } else {
      from = parsePixels(from) ?? (typeof from === "number" ? from : 0);
      to = parsePixels(to) ?? (typeof to === "number" ? to : 0);
    }
    normalized[ch] = {
      ...channelVal,
      duration,
      delay,
      from,
      to,
    };
  }
  return normalized;
}

export interface NormalizeElementOptions {
  canvasWidth?: number;
  canvasHeight?: number;
  sceneDuration?: number;
}

export function normalizeElement(elem: any, options: NormalizeElementOptions = {}): NormalizedElement {
  if (!elem) {
    return { type: "text", content: "", startAt: 0, startTime: 0, duration: 0 };
  }

  const { canvasWidth, canvasHeight, sceneDuration } = options;

  const startAt = parseDuration(elem.startAt ?? elem.startTime, sceneDuration) ?? 0;
  const duration = parseDuration(elem.duration, sceneDuration);
  const zIndex = parsePixels(elem.zIndex);
  const animation = normalizeAnimation(elem.animation, sceneDuration);
  const offsetX = parsePixels(elem.offsetX, canvasWidth);
  const offsetY = parsePixels(elem.offsetY, canvasHeight);
  // A colour adjustment is carried through as written; the compiler turns it
  // into filters, and validation rejects nonsense before that point.
  const colorAdjust = elem.grade ? { ...elem.grade } : undefined;
  // Blend and mask are passed through untouched; the compiler owns their
  // meaning, and validation rejects unknown modes before this point.
  const compositing = {
    ...(elem.blend ? { blend: elem.blend } : {}),
    ...(elem.mask ? { mask: { ...elem.mask } } : {}),
    ...(elem.motionBlur !== undefined ? { motionBlur: elem.motionBlur } : {}),
  };

  const rawWidth = parsePixels(elem.width, canvasWidth);
  const rawHeight = parsePixels(elem.height, canvasHeight);

  if (elem.type === "shape") {
    const shape: NormalizedShapeElement = {
      type: "shape",
      ...(colorAdjust ? { grade: colorAdjust } : {}),
      ...compositing,
      shape: elem.shape === "ellipse" || elem.shape === "line" ? elem.shape : "rect",
      width: rawWidth ?? 0,
      height: rawHeight ?? 0,
      fill: elem.fill,
      stroke: elem.stroke,
      strokeWidth: parsePixels(elem.strokeWidth) ?? 0,
      radius: parsePixels(elem.radius) ?? 0,
      x1: parsePixels(elem.x1),
      y1: parsePixels(elem.y1),
      x2: parsePixels(elem.x2),
      y2: parsePixels(elem.y2),
      x: elem.x,
      y: elem.y,
      offsetX,
      offsetY,
      startAt,
      startTime: parseDuration(elem.startTime) ?? 0,
      duration,
      sfx: elem.sfx,
      zIndex,
      animation,
    };
    if (shape.width <= 0 || shape.height <= 0) {
      throw new Error(
        `ShapeElement needs a positive width and height (got ${shape.width}x${shape.height}).`
      );
    }
    return shape;
  }

  if (elem.type === "image") {
    const img: NormalizedImageElement = {
      type: "image",
      ...(colorAdjust ? { grade: colorAdjust } : {}),
      ...compositing,
      src: elem.src || "",
      x: elem.x,
      y: elem.y,
      offsetX,
      offsetY,
      width: rawWidth,
      height: rawHeight,
      fit: elem.fit,
      chromaKey: normalizeChromaKey(elem.chromaKey),
      startAt,
      startTime: parseDuration(elem.startTime) ?? 0,
      duration,
      sfx: elem.sfx,
      zIndex,
      animation,
    };
    return img;
  }

  if (elem.type === "html") {
    const html: NormalizedHtmlElement = {
      type: "html",
      ...(colorAdjust ? { grade: colorAdjust } : {}),
      ...compositing,
      html: elem.html || "",
      css: elem.css,
      width: rawWidth ?? 0,
      height: rawHeight ?? 0,
      fit: elem.fit,
      backgroundColor: elem.backgroundColor,
      deviceScaleFactor: parseScale(elem.deviceScaleFactor),
      x: elem.x,
      y: elem.y,
      offsetX,
      offsetY,
      startAt,
      startTime: parseDuration(elem.startTime) ?? 0,
      duration,
      sfx: elem.sfx,
      zIndex,
      animation,
    };
    return html;
  }

  if (elem.type === "video") {
    const fit = elem.fit ?? "contain";
    const trimStart = parseDuration(elem.trimStart);
    const trimEnd = parseDuration(elem.trimEnd);
    if (trimStart !== undefined && trimEnd !== undefined && trimEnd <= trimStart) {
      throw new Error(
        `Video element trimEnd (${elem.trimEnd}) must be greater than trimStart (${elem.trimStart}).`
      );
    }
    // An explicit duration wins; otherwise trimEnd defines how long the clip
    // plays. `"0:32"`..`"0:45"` is 13s, which is what an author expects.
    const videoDuration =
      duration ?? (trimStart !== undefined && trimEnd !== undefined ? trimEnd - trimStart : undefined);
    const vid: NormalizedVideoElement = {
      type: "video",
      ...(colorAdjust ? { grade: colorAdjust } : {}),
      ...compositing,
      src: elem.src || "",
      x: elem.x,
      y: elem.y,
      offsetX,
      offsetY,
      width: rawWidth,
      height: rawHeight,
      fit,
      trimStart,
      trimEnd,
      loop: elem.loop,
      volume: parseVolume(elem.volume),
      chromaKey: normalizeChromaKey(elem.chromaKey),
      startAt,
      startTime: parseDuration(elem.startTime) ?? 0,
      duration: videoDuration,
      sfx: elem.sfx,
      zIndex,
      animation,
    };
    return vid;
  }

  const maxWidth = parsePixels(elem.maxWidth, canvasWidth);
  const lineHeight = parseLineHeight(elem.lineHeight, parsePixels(elem.fontSize, canvasHeight) ?? 48);
  const strokeWidth = parsePixels(elem.stroke?.width, canvasWidth);

  if (maxWidth !== undefined && maxWidth <= 0) {
    throw new Error(`Invalid TextElement 'maxWidth': ${elem.maxWidth}. Must be greater than 0.`);
  }
  if (lineHeight !== undefined && lineHeight <= 0) {
    throw new Error(`Invalid TextElement 'lineHeight': ${elem.lineHeight}. Must be greater than 0.`);
  }
  if (strokeWidth !== undefined && strokeWidth < 0) {
    throw new Error(`Invalid TextElement 'stroke.width': ${elem.stroke?.width}. Must be non-negative.`);
  }

  const rawContent = elem.content || "";
  const fontSize = parsePixels(elem.fontSize, canvasHeight);
  const effectiveFontSize = fontSize ?? 48;
  const content = maxWidth ? wrapText(rawContent, effectiveFontSize, maxWidth) : rawContent;

  const boxPadding = parsePixels(elem.boxPadding, canvasWidth);

  const text: NormalizedTextElement = {
    type: "text",
    ...(colorAdjust ? { grade: colorAdjust } : {}),
      ...compositing,
    content,
    fontSize,
    fontColor: elem.fontColor,
    fontFile: elem.fontFile,
    box: elem.box,
    boxColor: elem.boxColor,
    boxPadding,
    maxWidth,
    textAlign: elem.textAlign,
    lineHeight,
    stroke: elem.stroke
      ? {
          color: elem.stroke.color,
          width: strokeWidth ?? 0,
        }
      : undefined,
    shadow: elem.shadow
      ? {
          color: elem.shadow.color,
          x: parsePixels(elem.shadow.x, canvasWidth),
          y: parsePixels(elem.shadow.y, canvasHeight),
        }
      : undefined,
    x: elem.x,
    y: elem.y,
    offsetX,
    offsetY,
    startAt,
    startTime: parseDuration(elem.startTime) ?? 0,
    duration,
    sfx: elem.sfx,
    zIndex,
    animation,
    ...(Array.isArray(elem.captionWords) && elem.captionWords.length
      ? {
          captionWords: elem.captionWords.map((w: any) => ({
            word: String(w.word),
            at: parseDuration(w.at) ?? 0,
            duration: parseDuration(w.duration) ?? 0,
          })),
          highlight: elem.highlight,
        }
      : {}),
  };
  return text;
}
