/**
 * Utility functions for parsing numbers or unit strings (px, %, s, ms, fps, pt, x, numeric strings).
 */

export function parsePixels(
  val: number | string | undefined,
  refLength?: number,
  defaultValue?: number
): number | undefined {
  if (val === undefined || val === null || val === "") return defaultValue;
  if (typeof val === "number") return Number.isFinite(val) ? val : defaultValue;

  const str = String(val).trim();

  // Percentage e.g. "50%"
  if (str.endsWith("%")) {
    const num = parseFloat(str.slice(0, -1));
    if (Number.isFinite(num) && refLength !== undefined) {
      return (num / 100) * refLength;
    }
  }

  // Pixels e.g. "100px" or "100"
  if (str.toLowerCase().endsWith("px")) {
    const num = parseFloat(str.slice(0, -2));
    if (Number.isFinite(num)) return num;
  }

  // Points e.g. "72pt" -> 1pt = 4/3 px
  if (str.toLowerCase().endsWith("pt")) {
    const num = parseFloat(str.slice(0, -2));
    if (Number.isFinite(num)) return Math.round(num * (4 / 3));
  }

  const num = parseFloat(str);
  return Number.isFinite(num) ? num : defaultValue;
}

export function parseDuration(
  val: number | string | undefined,
  refDuration?: number,
  defaultValue?: number
): number | undefined {
  if (val === undefined || val === null || val === "") return defaultValue;
  if (typeof val === "number") return Number.isFinite(val) ? val : defaultValue;

  const str = String(val).trim();

  // Clock form: "mm:ss" or "hh:mm:ss", optionally with fractional seconds
  // ("1:02.5"). Parsed before the other forms because the colons are
  // unambiguous, and a malformed clock string is a typo worth surfacing.
  if (str.includes(":")) {
    const parts = str.split(":");
    if (parts.length > 3) {
      throw new Error(`Invalid time '${str}': expected mm:ss or hh:mm:ss.`);
    }
    let total = 0;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (!/^\d+(\.\d+)?$/.test(part)) {
        throw new Error(`Invalid time '${str}': '${part}' is not a number.`);
      }
      const n = parseFloat(part);
      // Every component but the first is bounded by 60: minutes and seconds
      // are sexagesimal. Only the final component may be fractional. The
      // leading component is unbounded, so "90:00" reads as 90 minutes.
      const isLast = i === parts.length - 1;
      if (i > 0 && (n >= 60 || (!isLast && !Number.isInteger(n)))) {
        throw new Error(`Invalid time '${str}': '${part}' must be a whole number below 60.`);
      }
      if (i === 0 && !isLast && !Number.isInteger(n)) {
        throw new Error(`Invalid time '${str}': '${part}' must be a whole number.`);
      }
      total = total * 60 + n;
    }
    return total;
  }

  // Percentage of scene duration e.g. "50%"
  if (str.endsWith("%")) {
    const num = parseFloat(str.slice(0, -1));
    if (Number.isFinite(num) && refDuration !== undefined) {
      return (num / 100) * refDuration;
    }
  }

  // Milliseconds e.g. "5000ms"
  if (str.toLowerCase().endsWith("ms")) {
    const num = parseFloat(str.slice(0, -2));
    if (Number.isFinite(num)) return num / 1000;
  }

  // Seconds e.g. "5s"
  if (str.toLowerCase().endsWith("s")) {
    const num = parseFloat(str.slice(0, -1));
    if (Number.isFinite(num)) return num;
  }

  const num = parseFloat(str);
  return Number.isFinite(num) ? num : defaultValue;
}

export function parseFps(val: number | string | undefined, defaultValue = 30): number {
  if (val === undefined || val === null || val === "") return defaultValue;
  if (typeof val === "number") return Number.isFinite(val) && val > 0 ? val : defaultValue;

  const str = String(val).trim();
  if (str.toLowerCase().endsWith("fps")) {
    const num = parseFloat(str.slice(0, -3));
    if (Number.isFinite(num) && num > 0) return num;
  }

  const num = parseFloat(str);
  return Number.isFinite(num) && num > 0 ? num : defaultValue;
}

export function parseVolume(val: number | string | undefined, defaultValue?: number): number | undefined {
  if (val === undefined || val === null || val === "") return defaultValue;
  if (typeof val === "number") return Number.isFinite(val) ? val : defaultValue;

  const str = String(val).trim();
  if (str.endsWith("%")) {
    const num = parseFloat(str.slice(0, -1));
    if (Number.isFinite(num)) return num / 100;
  }

  const num = parseFloat(str);
  return Number.isFinite(num) ? num : defaultValue;
}

export function parseScale(val: number | string | undefined, defaultValue?: number): number | undefined {
  if (val === undefined || val === null || val === "") return defaultValue;
  if (typeof val === "number") return Number.isFinite(val) ? val : defaultValue;

  const str = String(val).trim();
  if (str.toLowerCase().endsWith("x")) {
    const num = parseFloat(str.slice(0, -1));
    if (Number.isFinite(num)) return num;
  }

  const num = parseFloat(str);
  return Number.isFinite(num) ? num : defaultValue;
}

export function parseLineHeight(
  val: number | string | undefined,
  fontSize?: number,
  defaultValue?: number
): number | undefined {
  if (val === undefined || val === null || val === "") return defaultValue;
  if (typeof val === "number") return Number.isFinite(val) ? val : defaultValue;

  const str = String(val).trim();

  // "120%" -> 1.2
  if (str.endsWith("%")) {
    const num = parseFloat(str.slice(0, -1));
    if (Number.isFinite(num)) return num / 100;
  }

  // "24px" -> relative multiplier if fontSize is provided
  if (str.toLowerCase().endsWith("px")) {
    const num = parseFloat(str.slice(0, -2));
    if (Number.isFinite(num)) {
      if (fontSize && fontSize > 0) {
        return num / fontSize;
      }
      return num;
    }
  }

  const num = parseFloat(str);
  return Number.isFinite(num) ? num : defaultValue;
}
