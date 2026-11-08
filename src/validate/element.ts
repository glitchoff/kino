import type { ValidationIssue } from "./error.js";
import {
  isFlexibleFiniteNumber,
  isFlexibleNonNegativeNumber,
  isFlexiblePositiveNumber,
  isNonEmptyString,
  isObject,
} from "./helpers.js";
import { parseDuration, parsePixels, parseVolume } from "../normalize/unit-parser.js";

const VALID_EASINGS = [
  "linear", "easeIn", "easeOut", "easeInOut",
  "easeInSine", "easeOutSine", "easeInOutSine",
  "easeInExpo", "easeOutExpo", "easeInOutExpo",
  "easeInCirc", "easeOutCirc", "easeInOutCirc",
  "easeInBack", "easeOutBack", "easeInOutBack",
  "easeOutElastic", "easeOutBounce",
] as const;

function validateEasing(easing: unknown, path: string, issues: ValidationIssue[]): void {
  if (typeof easing !== "string" || !VALID_EASINGS.includes(easing as any)) {
    issues.push({
      path,
      message: `Expected one of: ${VALID_EASINGS.join(", ")}, received ${JSON.stringify(easing)}`,
    });
  }
}

/** `{ keyframes: [{ at, value, easing? }] }` — an alternative to `{ from, to }`. */
function validateKeyframedValue(
  channelVal: Record<string, unknown>,
  chPath: string,
  ch: string,
  issues: ValidationIssue[]
): void {
  const kfs = channelVal.keyframes;
  if (!Array.isArray(kfs)) {
    issues.push({ path: `${chPath}.keyframes`, message: "Expected an array of keyframes" });
    return;
  }
  if (kfs.length === 0) {
    issues.push({ path: `${chPath}.keyframes`, message: "Expected at least one keyframe" });
  }
  kfs.forEach((kf, i) => {
    const kfPath = `${chPath}.keyframes[${i}]`;
    if (!isObject(kf)) {
      issues.push({ path: kfPath, message: "Expected a keyframe object" });
      return;
    }
    if (!isFlexibleNonNegativeNumber(kf.at)) {
      issues.push({ path: `${kfPath}.at`, message: `Expected a non-negative time, received ${kf.at}` });
    }
    if (!isFlexibleFiniteNumber(kf.value)) {
      issues.push({ path: `${kfPath}.value`, message: `Expected a finite number or unit value, received ${kf.value}` });
    }
    if (kf.easing !== undefined) validateEasing(kf.easing, `${kfPath}.easing`, issues);
    if (ch === "opacity") {
      const v = parseVolume(kf.value as string | number | undefined);
      if (v !== undefined && (v < 0 || v > 1)) {
        issues.push({ path: `${kfPath}.value`, message: `Expected value between 0 and 1 (or 0%-100%), received ${kf.value}` });
      }
    }
  });
  if (channelVal.easing !== undefined) validateEasing(channelVal.easing, `${chPath}.easing`, issues);
}

function validateAnimation(
  anim: Record<string, unknown>,
  animPath: string,
  issues: ValidationIssue[]
): void {
  const channels = ["opacity", "x", "y", "scale"] as const;
  for (const ch of channels) {
    const channelVal = anim[ch];
    if (channelVal === undefined) continue;

    const chPath = `${animPath}.${ch}`;
    if (!isObject(channelVal)) {
      issues.push({ path: chPath, message: `Expected an animation channel object for ${ch}` });
      continue;
    }

    if (Array.isArray(channelVal.keyframes)) {
      validateKeyframedValue(channelVal, chPath, ch, issues);
      continue;
    }

    if (!isFlexiblePositiveNumber(channelVal.duration)) {
      issues.push({ path: `${chPath}.duration`, message: `Expected a positive number or valid duration, received ${channelVal.duration}` });
    }
    if (channelVal.delay !== undefined && !isFlexibleNonNegativeNumber(channelVal.delay)) {
      issues.push({ path: `${chPath}.delay`, message: `Expected a non-negative number or valid duration, received ${channelVal.delay}` });
    }
    if (channelVal.easing !== undefined) {
      if (typeof channelVal.easing !== "string" || !VALID_EASINGS.includes(channelVal.easing as any)) {
        issues.push({ path: `${chPath}.easing`, message: `Expected one of: ${VALID_EASINGS.join(", ")}, received ${JSON.stringify(channelVal.easing)}` });
      }
    }
    if (!isFlexibleFiniteNumber(channelVal.from)) {
      issues.push({ path: `${chPath}.from`, message: `Expected a finite number or unit value, received ${channelVal.from}` });
    }
    if (!isFlexibleFiniteNumber(channelVal.to)) {
      issues.push({ path: `${chPath}.to`, message: `Expected a finite number or unit value, received ${channelVal.to}` });
    }
    if (ch === "opacity") {
      const fromVal = parseVolume(channelVal.from as string | number | undefined);
      const toVal = parseVolume(channelVal.to as string | number | undefined);
      if (fromVal !== undefined && (fromVal < 0 || fromVal > 1)) {
        issues.push({ path: `${chPath}.from`, message: `Expected value between 0 and 1 (or 0%-100%), received ${channelVal.from}` });
      }
      if (toVal !== undefined && (toVal < 0 || toVal > 1)) {
        issues.push({ path: `${chPath}.to`, message: `Expected value between 0 and 1 (or 0%-100%), received ${channelVal.to}` });
      }
    }
    if (ch === "scale") {
      const fromVal = parsePixels(channelVal.from as string | number | undefined);
      const toVal = parsePixels(channelVal.to as string | number | undefined);
      if (fromVal !== undefined && fromVal < 0) {
        issues.push({ path: `${chPath}.from`, message: `Expected a non-negative scale, received ${channelVal.from}` });
      }
      if (toVal !== undefined && toVal < 0) {
        issues.push({ path: `${chPath}.to`, message: `Expected a non-negative scale, received ${channelVal.to}` });
      }
    }
  }
}

const VALID_FITS = ["contain", "cover", "fill", "none"] as const;

function validateMediaDimensions(elem: Record<string, unknown>, elemPath: string, issues: ValidationIssue[]): void {
  for (const key of ["width", "height"] as const) {
    if (elem[key] !== undefined && !isFlexiblePositiveNumber(elem[key])) {
      issues.push({ path: `${elemPath}.${key}`, message: `Expected a positive number or unit dimension, received ${elem[key]}` });
    }
  }
  if (elem.fit !== undefined && (typeof elem.fit !== "string" || !VALID_FITS.includes(elem.fit as any))) {
    issues.push({ path: `${elemPath}.fit`, message: `Expected "contain", "cover", "fill", or "none", received ${JSON.stringify(elem.fit)}` });
  }
}

function validateTextElement(elem: Record<string, unknown>, elemPath: string, issues: ValidationIssue[]): void {
  if (elem.content !== undefined && typeof elem.content !== "string") {
    issues.push({ path: `${elemPath}.content`, message: `Expected a string, received ${typeof elem.content}` });
  }
  if (elem.fontSize !== undefined && !isFlexiblePositiveNumber(elem.fontSize)) {
    issues.push({ path: `${elemPath}.fontSize`, message: `Expected a positive number or unit size, received ${elem.fontSize}` });
  }
  if (elem.fontColor !== undefined && !isNonEmptyString(elem.fontColor)) {
    issues.push({ path: `${elemPath}.fontColor`, message: "Expected a non-empty fontColor string" });
  }
  if (elem.fontFile !== undefined && !isNonEmptyString(elem.fontFile)) {
    issues.push({ path: `${elemPath}.fontFile`, message: "Expected a non-empty fontFile path string" });
  }
  if (elem.maxWidth !== undefined && !isFlexiblePositiveNumber(elem.maxWidth)) {
    issues.push({ path: `${elemPath}.maxWidth`, message: `Expected a positive number or unit dimension, received ${elem.maxWidth}` });
  }
  if (elem.textAlign !== undefined) {
    if (typeof elem.textAlign !== "string" || !["left", "center", "right"].includes(elem.textAlign)) {
      issues.push({ path: `${elemPath}.textAlign`, message: `Expected "left", "center", or "right", received ${JSON.stringify(elem.textAlign)}` });
    }
  }
  if (elem.lineHeight !== undefined && !isFlexiblePositiveNumber(elem.lineHeight)) {
    issues.push({ path: `${elemPath}.lineHeight`, message: `Expected a positive number or height string, received ${elem.lineHeight}` });
  }
  if (elem.stroke !== undefined) {
    if (!isObject(elem.stroke)) {
      issues.push({ path: `${elemPath}.stroke`, message: "Expected a stroke object" });
    } else {
      if (!isNonEmptyString(elem.stroke.color)) {
        issues.push({ path: `${elemPath}.stroke.color`, message: "Expected a non-empty stroke color string" });
      }
      if (elem.stroke.width !== undefined && !isFlexibleNonNegativeNumber(elem.stroke.width)) {
        issues.push({ path: `${elemPath}.stroke.width`, message: `Expected a non-negative number or unit width, received ${elem.stroke.width}` });
      }
    }
  }
  if (elem.shadow !== undefined) {
    if (!isObject(elem.shadow)) {
      issues.push({ path: `${elemPath}.shadow`, message: "Expected a shadow object" });
    } else {
      if (!isNonEmptyString(elem.shadow.color)) {
        issues.push({ path: `${elemPath}.shadow.color`, message: "Expected a non-empty shadow color string" });
      }
      if (elem.shadow.x !== undefined && !isFlexibleFiniteNumber(elem.shadow.x)) {
        issues.push({ path: `${elemPath}.shadow.x`, message: `Expected a finite number or unit value, received ${elem.shadow.x}` });
      }
      if (elem.shadow.y !== undefined && !isFlexibleFiniteNumber(elem.shadow.y)) {
        issues.push({ path: `${elemPath}.shadow.y`, message: `Expected a finite number or unit value, received ${elem.shadow.y}` });
      }
    }
  }
}

function validateVideoElement(elem: Record<string, unknown>, elemPath: string, issues: ValidationIssue[]): void {
  if (!isNonEmptyString(elem.src)) {
    issues.push({ path: `${elemPath}.src`, message: "Expected a non-empty file path or URL for video element" });
  }
  validateMediaDimensions(elem, elemPath, issues);
  if (elem.trimStart !== undefined && !isFlexibleNonNegativeNumber(elem.trimStart)) {
    issues.push({ path: `${elemPath}.trimStart`, message: `Expected a non-negative number or duration string, received ${elem.trimStart}` });
  }
  if (elem.trimEnd !== undefined && !isFlexibleNonNegativeNumber(elem.trimEnd)) {
    issues.push({ path: `${elemPath}.trimEnd`, message: `Expected a non-negative number or duration string, received ${elem.trimEnd}` });
  }
  if (elem.loop !== undefined && typeof elem.loop !== "boolean") {
    issues.push({ path: `${elemPath}.loop`, message: `Expected a boolean, received ${typeof elem.loop}` });
  }
  if (elem.volume !== undefined && !isFlexibleNonNegativeNumber(elem.volume)) {
    issues.push({ path: `${elemPath}.volume`, message: `Expected a non-negative volume value, received ${elem.volume}` });
  }
}

const BLEND_MODES = new Set([
  "normal", "multiply", "screen", "overlay", "softlight", "hardlight",
  "difference", "exclusion", "darken", "lighten", "add",
]);

function validateBlend(
  blend: unknown,
  elemPath: string,
  issues: ValidationIssue[]
): void {
  const path = `${elemPath}.blend`;
  if (typeof blend !== "string" || !BLEND_MODES.has(blend)) {
    // A typo here would otherwise reach ffmpeg as an unknown `all_mode` and fail
    // with a much less helpful message.
    issues.push({
      path,
      message: `Unknown blend mode ${JSON.stringify(blend)}. Expected one of: ${[...BLEND_MODES].join(", ")}`,
    });
  }
}

function validateMask(
  mask: unknown,
  elemPath: string,
  issues: ValidationIssue[]
): void {
  const path = `${elemPath}.mask`;
  if (!isObject(mask)) {
    issues.push({ path, message: "Expected a mask object" });
    return;
  }
  if (mask.shape === undefined && mask.src === undefined) {
    issues.push({ path, message: "A mask needs either `shape` or `src`" });
  }
  if (mask.shape !== undefined && !["rect", "ellipse", "linear"].includes(mask.shape as string)) {
    issues.push({ path: `${path}.shape`, message: `Expected rect, ellipse or linear, received ${JSON.stringify(mask.shape)}` });
  }
  if (mask.src !== undefined && typeof mask.src !== "string") {
    issues.push({ path: `${path}.src`, message: "Expected a file path or URL" });
  }
  if (mask.feather !== undefined && (typeof mask.feather !== "number" || mask.feather < 0)) {
    issues.push({ path: `${path}.feather`, message: "Expected a non-negative number of pixels" });
  }
}

function validateCurves(
  curves: unknown,
  path: string,
  issues: ValidationIssue[]
): void {
  if (!isObject(curves)) {
    issues.push({ path, message: "Expected a curves object" });
    return;
  }
  const channels = ["master", "red", "green", "blue"];
  for (const key of channels) {
    const points = curves[key];
    if (points === undefined) continue;
    if (!Array.isArray(points)) {
      issues.push({ path: `${path}.${key}`, message: "Expected an array of [input, output] pairs" });
      continue;
    }
    for (const point of points) {
      if (!Array.isArray(point) || point.length !== 2 || typeof point[0] !== "number" || typeof point[1] !== "number") {
        issues.push({ path: `${path}.${key}`, message: `Expected [input, output] numbers, received ${JSON.stringify(point)}` });
      } else if (point[0] < 0 || point[0] > 1 || point[1] < 0 || point[1] > 1) {
        issues.push({ path: `${path}.${key}`, message: `Points must be within 0..1, received ${JSON.stringify(point)}` });
      }
    }
  }
}

function validateBalance(
  balance: unknown,
  path: string,
  issues: ValidationIssue[]
): void {
  if (!isObject(balance)) {
    issues.push({ path, message: "Expected a balance object" });
    return;
  }
  for (const key of ["shadows", "midtones", "highlights"]) {
    const triple = balance[key];
    if (triple === undefined) continue;
    if (!Array.isArray(triple) || triple.length !== 3 || triple.some((n) => typeof n !== "number" || n < -1 || n > 1)) {
      issues.push({ path: `${path}.${key}`, message: "Expected three numbers in -1..1, one per channel" });
    }
  }
}

export function validateColorAdjust(
  color: unknown,
  elemPath: string,
  issues: ValidationIssue[]
): void {
  const path = `${elemPath}.grade`;
  if (!isObject(color)) {
    issues.push({ path, message: "Expected a colour adjustment object" });
    return;
  }
  const num = (key: string, min: number, max: number) => {
    const v = color[key];
    if (v === undefined) return;
    if (typeof v !== "number" || Number.isNaN(v)) {
      issues.push({ path: `${path}.${key}`, message: `Expected a number, received ${JSON.stringify(v)}` });
      return;
    }
    if (v < min || v > max) {
      issues.push({ path: `${path}.${key}`, message: `Expected ${min}..${max}, received ${v}` });
    }
  };
  // Ranges follow ffmpeg's `eq`/`hue`, so a value that would be silently
  // clamped is rejected instead.
  if (color.lut !== undefined) {
    if (typeof color.lut !== "string" || color.lut.length === 0) {
      issues.push({ path: `${path}.lut`, message: "Expected a .cube file path or URL" });
    } else if (!/\.cube$/i.test(color.lut) && !/^https?:/i.test(color.lut)) {
      issues.push({ path: `${path}.lut`, message: `Expected a .cube file, received ${JSON.stringify(color.lut)}` });
    }
  }
  if (color.lutInterp !== undefined) {
    const modes = ["nearest", "trilinear", "tetrahedral", "pyramid", "prism"];
    if (!modes.includes(color.lutInterp as string)) {
      issues.push({ path: `${path}.lutInterp`, message: `Expected one of: ${modes.join(", ")}` });
    }
  }
  if (color.curves !== undefined) {
    validateCurves(color.curves, `${path}.curves`, issues);
  }
  if (color.balance !== undefined) {
    validateBalance(color.balance, `${path}.balance`, issues);
  }
  num("brightness", -1, 1);
  num("contrast", 0, 3);
  num("saturation", 0, 3);
  num("hue", -180, 180);
  num("gamma", 0.1, 10);

  for (const key of ["lift", "gain"] as const) {
    const v = color[key];
    if (v === undefined) continue;
    const range: [number, number] = key === "lift" ? [-1, 1] : [0, 2];
    if (Array.isArray(v)) {
      if (v.length !== 3 || v.some((n) => typeof n !== "number" || n < range[0] || n > range[1])) {
        issues.push({ path: `${path}.${key}`, message: `Expected three numbers in ${range[0]}..${range[1]}` });
      }
    } else if (typeof v !== "number" || v < range[0] || v > range[1]) {
      issues.push({ path: `${path}.${key}`, message: `Expected a number in ${range[0]}..${range[1]}, received ${JSON.stringify(v)}` });
    }
  }
}

function validateShapeElement(
  elem: Record<string, unknown>,
  elemPath: string,
  issues: ValidationIssue[]
): void {
  const kind = elem.shape;
  if (kind !== "rect" && kind !== "ellipse" && kind !== "line") {
    issues.push({
      path: `${elemPath}.shape`,
      message: `Expected "rect", "ellipse", or "line", received ${JSON.stringify(kind)}`,
    });
  }
  if (!isFlexiblePositiveNumber(elem.width)) {
    issues.push({ path: `${elemPath}.width`, message: `Expected a positive width, received ${elem.width}` });
  }
  if (!isFlexiblePositiveNumber(elem.height)) {
    issues.push({ path: `${elemPath}.height`, message: `Expected a positive height, received ${elem.height}` });
  }
  if (elem.strokeWidth !== undefined && !isFlexibleNonNegativeNumber(elem.strokeWidth)) {
    issues.push({ path: `${elemPath}.strokeWidth`, message: `Expected a non-negative thickness, received ${elem.strokeWidth}` });
  }
  if (elem.radius !== undefined && !isFlexibleNonNegativeNumber(elem.radius)) {
    issues.push({ path: `${elemPath}.radius`, message: `Expected a non-negative radius, received ${elem.radius}` });
  }
  // A shape with neither fill nor stroke draws nothing, which is almost always
  // a mistake rather than an intent.
  const hasFill = typeof elem.fill === "string" && elem.fill !== "transparent" && elem.fill !== "none";
  const hasStroke = typeof elem.stroke === "string" && elem.stroke !== "transparent" && elem.stroke !== "none";
  if (!hasFill && !hasStroke) {
    issues.push({
      path: elemPath,
      message: "Shape has neither a fill nor a stroke, so nothing will be drawn.",
    });
  }
}

function validateHtmlElement(elem: Record<string, unknown>, elemPath: string, issues: ValidationIssue[]): void {
  if (!isNonEmptyString(elem.html)) {
    issues.push({ path: `${elemPath}.html`, message: "Expected a non-empty HTML string" });
  }
  for (const key of ["width", "height"] as const) {
    if (!isFlexiblePositiveNumber(elem[key])) {
      issues.push({ path: `${elemPath}.${key}`, message: `Expected a positive number or unit dimension, received ${elem[key]}` });
    }
  }
  if (elem.deviceScaleFactor !== undefined && !isFlexiblePositiveNumber(elem.deviceScaleFactor)) {
    issues.push({ path: `${elemPath}.deviceScaleFactor`, message: `Expected a positive number or scale string, received ${elem.deviceScaleFactor}` });
  }
  if (elem.fit !== undefined && !VALID_FITS.includes(elem.fit as any)) {
    issues.push({ path: `${elemPath}.fit`, message: `Expected "contain", "cover", "fill", or "none", received ${JSON.stringify(elem.fit)}` });
  }
}

export function validateElement(
  elem: unknown,
  elemPath: string,
  templateIds: Set<string>,
  issues: ValidationIssue[]
): void {
  if (!isObject(elem)) {
    issues.push({ path: elemPath, message: `Expected an element object, received ${typeof elem}` });
    return;
  }

  // startAt / startTime
  const startVal = elem.startAt !== undefined ? elem.startAt : elem.startTime;
  const startPropName = elem.startAt !== undefined ? "startAt" : "startTime";
  if (startVal !== undefined && !isFlexibleNonNegativeNumber(startVal)) {
    issues.push({ path: `${elemPath}.${startPropName}`, message: `Expected a non-negative number or duration string, received ${startVal}` });
  }
  if (elem.duration !== undefined && !isFlexiblePositiveNumber(elem.duration)) {
    issues.push({ path: `${elemPath}.duration`, message: `Expected a positive number or duration string, received ${elem.duration}` });
  }
  if (elem.zIndex !== undefined && !isFlexibleFiniteNumber(elem.zIndex)) {
    issues.push({ path: `${elemPath}.zIndex`, message: `Expected a finite number, received ${elem.zIndex}` });
  }

  // Position
  if (elem.x !== undefined && typeof elem.x !== "number" && typeof elem.x !== "string") {
    issues.push({ path: `${elemPath}.x`, message: `Expected a number or string, received ${typeof elem.x}` });
  }
  if (elem.y !== undefined && typeof elem.y !== "number" && typeof elem.y !== "string") {
    issues.push({ path: `${elemPath}.y`, message: `Expected a number or string, received ${typeof elem.y}` });
  }
  if (elem.offsetX !== undefined && !isFlexibleFiniteNumber(elem.offsetX)) {
    issues.push({ path: `${elemPath}.offsetX`, message: `Expected a finite number or unit value, received ${elem.offsetX}` });
  }
  if (elem.offsetY !== undefined && !isFlexibleFiniteNumber(elem.offsetY)) {
    issues.push({ path: `${elemPath}.offsetY`, message: `Expected a finite number or unit value, received ${elem.offsetY}` });
  }
  if (typeof elem.x === "string" && elem.offsetX !== undefined && /^(left|center|right|top|bottom)[+-]/.test(elem.x)) {
    issues.push({ path: `${elemPath}.x`, message: `Ambiguous position: shorthand "${elem.x}" combined with explicit offsetX. Use either shorthand or offsetX, not both.` });
  }
  if (typeof elem.y === "string" && elem.offsetY !== undefined && /^(left|center|right|top|bottom)[+-]/.test(elem.y)) {
    issues.push({ path: `${elemPath}.y`, message: `Ambiguous position: shorthand "${elem.y}" combined with explicit offsetY. Use either shorthand or offsetY, not both.` });
  }

  const elemType = elem.type ?? "text";

  if (elemType === "image") {
    if (!isNonEmptyString(elem.src)) {
      issues.push({ path: `${elemPath}.src`, message: "Expected a non-empty file path or URL for image element" });
    }
    validateMediaDimensions(elem, elemPath, issues);
  } else if (elemType === "html") {
    validateHtmlElement(elem, elemPath, issues);
  } else if (elemType === "video") {
    validateVideoElement(elem, elemPath, issues);
  } else if (elemType === "text") {
    validateTextElement(elem, elemPath, issues);
  } else if (elemType === "shape") {
    validateShapeElement(elem, elemPath, issues);
  } else {
    issues.push({ path: `${elemPath}.type`, message: `Expected "text", "image", "html", "video", or "shape", received ${JSON.stringify(elem.type)}` });
  }

  // Template reference
  if (elem.template !== undefined) {
    if (!isNonEmptyString(elem.template)) {
      issues.push({ path: `${elemPath}.template`, message: "Expected a non-empty template id string" });
    } else if (!templateIds.has(elem.template)) {
      issues.push({ path: `${elemPath}.template`, message: `Template "${elem.template}" is not defined in composition.templates` });
    }
    if (elem.type === undefined) {
      issues.push({ path: `${elemPath}.type`, message: "Element using a template must specify its type" });
    }
  }

  // Animation
  if (elem.grade !== undefined) {
    validateColorAdjust(elem.grade, elemPath, issues);
  }
  if (elem.blend !== undefined) {
    validateBlend(elem.blend, elemPath, issues);
  }
  if (elem.mask !== undefined) {
    validateMask(elem.mask, elemPath, issues);
  }

  if (elem.animation !== undefined) {
    const animPath = `${elemPath}.animation`;
    if (!isObject(elem.animation)) {
      issues.push({ path: animPath, message: "Expected an animation object" });
    } else {
      validateAnimation(elem.animation, animPath, issues);
    }
  }
}
