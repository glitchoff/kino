export function isFiniteNumber(val: unknown): val is number {
  return typeof val === "number" && Number.isFinite(val);
}

export function isInteger(val: unknown): val is number {
  return isFiniteNumber(val) && Number.isInteger(val);
}

export function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

export function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}
