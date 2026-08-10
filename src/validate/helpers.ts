import {
  parsePixels,
  parseDuration,
  parseFps,
} from "../normalize/unit-parser.js";

export function isFiniteNumber(val: unknown): val is number {
  return typeof val === "number" && Number.isFinite(val);
}

export function isInteger(val: unknown): val is number {
  return isFiniteNumber(val) && Number.isInteger(val);
}

export function isFlexibleFiniteNumber(val: unknown): boolean {
  if (isFiniteNumber(val)) return true;
  if (typeof val === "string" && val.trim().length > 0) {
    const num = parsePixels(val);
    return num !== undefined && Number.isFinite(num);
  }
  return false;
}

export function isFlexiblePositiveNumber(val: unknown): boolean {
  if (isFiniteNumber(val)) return val > 0;
  if (typeof val === "string" && val.trim().length > 0) {
    const num = parsePixels(val) ?? parseDuration(val) ?? parseFps(val);
    return num !== undefined && Number.isFinite(num) && num > 0;
  }
  return false;
}

export function isFlexibleNonNegativeNumber(val: unknown): boolean {
  if (isFiniteNumber(val)) return val >= 0;
  if (typeof val === "string" && val.trim().length > 0) {
    const num = parsePixels(val) ?? parseDuration(val);
    return num !== undefined && Number.isFinite(num) && num >= 0;
  }
  return false;
}

export function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

export function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}
