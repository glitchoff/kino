import type { ValidationIssue } from "./error.js";
import { isFiniteNumber, isNonEmptyString, isObject } from "./helpers.js";

const VALID_EASINGS = [
  "linear", "easeIn", "easeOut", "easeInOut",
  "easeInSine", "easeOutSine", "easeInOutSine",
  "easeInExpo", "easeOutExpo", "easeInOutExpo",
  "easeInCirc", "easeOutCirc", "easeInOutCirc",
] as const;

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

    if (!isFiniteNumber(channelVal.duration) || channelVal.duration <= 0) {
      issues.push({ path: `${chPath}.duration`, message: `Expected a positive number, received ${channelVal.duration}` });
    }
    if (channelVal.delay !== undefined && (!isFiniteNumber(channelVal.delay) || channelVal.delay < 0)) {
      issues.push({ path: `${chPath}.delay`, message: `Expected a non-negative number, received ${channelVal.delay}` });
    }
    if (channelVal.easing !== undefined) {
      if (typeof channelVal.easing !== "string" || !VALID_EASINGS.includes(channelVal.easing as any)) {
        issues.push({ path: `${chPath}.easing`, message: `Expected one of: ${VALID_EASINGS.join(", ")}, received ${JSON.stringify(channelVal.easing)}` });
      }
    }
    if (!isFiniteNumber(channelVal.from)) {
      issues.push({ path: `${chPath}.from`, message: `Expected a finite number, received ${channelVal.from}` });
    }
    if (!isFiniteNumber(channelVal.to)) {
      issues.push({ path: `${chPath}.to`, message: `Expected a finite number, received ${channelVal.to}` });
    }
    if (ch === "opacity") {
      if (isFiniteNumber(channelVal.from) && (channelVal.from < 0 || channelVal.from > 1)) {
        issues.push({ path: `${chPath}.from`, message: `Expected value between 0 and 1, received ${channelVal.from}` });
      }
      if (isFiniteNumber(channelVal.to) && (channelVal.to < 0 || channelVal.to > 1)) {
        issues.push({ path: `${chPath}.to`, message: `Expected value between 0 and 1, received ${channelVal.to}` });
      }
    }
    if (ch === "scale") {
      if (isFiniteNumber(channelVal.from) && channelVal.from < 0) {
        issues.push({ path: `${chPath}.from`, message: `Expected a non-negative number, received ${channelVal.from}` });
      }
      if (isFiniteNumber(channelVal.to) && channelVal.to < 0) {
        issues.push({ path: `${chPath}.to`, message: `Expected a non-negative number, received ${channelVal.to}` });
      }
    }
  }
}

const VALID_FITS = ["contain", "cover", "fill", "none"] as const;

function validateMediaDimensions(elem: Record<string, unknown>, elemPath: string, issues: ValidationIssue[]): void {
  for (const key of ["width", "height"] as const) {
    if (elem[key] !== undefined && (!isFiniteNumber(elem[key]) || (elem[key] as number) <= 0)) {
      issues.push({ path: `${elemPath}.${key}`, message: `Expected a positive number, received ${elem[key]}` });
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
  if (elem.fontSize !== undefined && (!isFiniteNumber(elem.fontSize) || (elem.fontSize as number) <= 0)) {
    issues.push({ path: `${elemPath}.fontSize`, message: `Expected a positive number, received ${elem.fontSize}` });
  }
  if (elem.fontColor !== undefined && !isNonEmptyString(elem.fontColor)) {
    issues.push({ path: `${elemPath}.fontColor`, message: "Expected a non-empty fontColor string" });
  }
  if (elem.fontFile !== undefined && !isNonEmptyString(elem.fontFile)) {
    issues.push({ path: `${elemPath}.fontFile`, message: "Expected a non-empty fontFile path string" });
  }
  if (elem.maxWidth !== undefined && (!isFiniteNumber(elem.maxWidth) || (elem.maxWidth as number) <= 0)) {
    issues.push({ path: `${elemPath}.maxWidth`, message: `Expected a positive number, received ${elem.maxWidth}` });
  }
  if (elem.textAlign !== undefined) {
    if (typeof elem.textAlign !== "string" || !["left", "center", "right"].includes(elem.textAlign)) {
      issues.push({ path: `${elemPath}.textAlign`, message: `Expected "left", "center", or "right", received ${JSON.stringify(elem.textAlign)}` });
    }
  }
  if (elem.lineHeight !== undefined && (!isFiniteNumber(elem.lineHeight) || (elem.lineHeight as number) <= 0)) {
    issues.push({ path: `${elemPath}.lineHeight`, message: `Expected a positive number, received ${elem.lineHeight}` });
  }
  if (elem.stroke !== undefined) {
    if (!isObject(elem.stroke)) {
      issues.push({ path: `${elemPath}.stroke`, message: "Expected a stroke object" });
    } else {
      if (!isNonEmptyString(elem.stroke.color)) {
        issues.push({ path: `${elemPath}.stroke.color`, message: "Expected a non-empty stroke color string" });
      }
      if (!isFiniteNumber(elem.stroke.width) || (elem.stroke.width as number) < 0) {
        issues.push({ path: `${elemPath}.stroke.width`, message: `Expected a non-negative number, received ${elem.stroke.width}` });
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
      if (elem.shadow.x !== undefined && !isFiniteNumber(elem.shadow.x)) {
        issues.push({ path: `${elemPath}.shadow.x`, message: `Expected a finite number, received ${elem.shadow.x}` });
      }
      if (elem.shadow.y !== undefined && !isFiniteNumber(elem.shadow.y)) {
        issues.push({ path: `${elemPath}.shadow.y`, message: `Expected a finite number, received ${elem.shadow.y}` });
      }
    }
  }
}

function validateVideoElement(elem: Record<string, unknown>, elemPath: string, issues: ValidationIssue[]): void {
  if (!isNonEmptyString(elem.src)) {
    issues.push({ path: `${elemPath}.src`, message: "Expected a non-empty file path or URL for video element" });
  }
  validateMediaDimensions(elem, elemPath, issues);
  if (elem.trimStart !== undefined && (!isFiniteNumber(elem.trimStart) || (elem.trimStart as number) < 0)) {
    issues.push({ path: `${elemPath}.trimStart`, message: `Expected a non-negative number, received ${elem.trimStart}` });
  }
  if (elem.loop !== undefined && typeof elem.loop !== "boolean") {
    issues.push({ path: `${elemPath}.loop`, message: `Expected a boolean, received ${typeof elem.loop}` });
  }
  if (elem.volume !== undefined && (!isFiniteNumber(elem.volume) || (elem.volume as number) < 0)) {
    issues.push({ path: `${elemPath}.volume`, message: `Expected a non-negative number, received ${elem.volume}` });
  }
}

function validateHtmlElement(elem: Record<string, unknown>, elemPath: string, issues: ValidationIssue[]): void {
  if (!isNonEmptyString(elem.html)) {
    issues.push({ path: `${elemPath}.html`, message: "Expected a non-empty HTML string" });
  }
  for (const key of ["width", "height"] as const) {
    if (!isFiniteNumber(elem[key]) || (elem[key] as number) <= 0) {
      issues.push({ path: `${elemPath}.${key}`, message: `Expected a positive number, received ${elem[key]}` });
    }
  }
  if (elem.deviceScaleFactor !== undefined && (!isFiniteNumber(elem.deviceScaleFactor) || (elem.deviceScaleFactor as number) <= 0)) {
    issues.push({ path: `${elemPath}.deviceScaleFactor`, message: `Expected a positive number, received ${elem.deviceScaleFactor}` });
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
  if (startVal !== undefined && (!isFiniteNumber(startVal) || (startVal as number) < 0)) {
    issues.push({ path: `${elemPath}.${startPropName}`, message: `Expected a non-negative number, received ${startVal}` });
  }
  if (elem.duration !== undefined && (!isFiniteNumber(elem.duration) || (elem.duration as number) <= 0)) {
    issues.push({ path: `${elemPath}.duration`, message: `Expected a positive number, received ${elem.duration}` });
  }
  if (elem.zIndex !== undefined && !isFiniteNumber(elem.zIndex)) {
    issues.push({ path: `${elemPath}.zIndex`, message: `Expected a finite number, received ${elem.zIndex}` });
  }

  // Position
  if (elem.x !== undefined && typeof elem.x !== "number" && typeof elem.x !== "string") {
    issues.push({ path: `${elemPath}.x`, message: `Expected a number or string, received ${typeof elem.x}` });
  }
  if (elem.y !== undefined && typeof elem.y !== "number" && typeof elem.y !== "string") {
    issues.push({ path: `${elemPath}.y`, message: `Expected a number or string, received ${typeof elem.y}` });
  }
  if (elem.offsetX !== undefined && !isFiniteNumber(elem.offsetX)) {
    issues.push({ path: `${elemPath}.offsetX`, message: `Expected a finite number, received ${elem.offsetX}` });
  }
  if (elem.offsetY !== undefined && !isFiniteNumber(elem.offsetY)) {
    issues.push({ path: `${elemPath}.offsetY`, message: `Expected a finite number, received ${elem.offsetY}` });
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
  } else {
    issues.push({ path: `${elemPath}.type`, message: `Expected "text", "image", "html", or "video", received ${JSON.stringify(elem.type)}` });
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
  if (elem.animation !== undefined) {
    const animPath = `${elemPath}.animation`;
    if (!isObject(elem.animation)) {
      issues.push({ path: animPath, message: "Expected an animation object" });
    } else {
      validateAnimation(elem.animation, animPath, issues);
    }
  }
}
