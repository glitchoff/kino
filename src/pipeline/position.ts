// ---------------------------------------------------------------------------
// FFmpeg string / position helpers
// ---------------------------------------------------------------------------

export function normalizeColor(color?: string): string {
  if (!color) return "black";
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      return `0x${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
    }
    return `0x${hex}`;
  }
  return color;
}

export function escapeFFmpegStr(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "'\\''")
    .replace(/:/g, "\\:");
}

export function escapeExpr(expr: string): string {
  return expr.replace(/,/g, "\\,");
}

// ---------------------------------------------------------------------------
// Named position resolution
// ---------------------------------------------------------------------------

interface ShorthandParse {
  anchor: string;
  offset: number;
}

function parseShorthand(val: string): ShorthandParse | null {
  const match = val.match(/^(left|center|right|top|bottom)([+-]\d+(?:\.\d+)?)$/);
  if (!match) return null;
  return { anchor: match[1], offset: parseFloat(match[2]) };
}

function resolveNamedPosition(val: string, defaultExpr: string): string | null {
  if (val === "left") return "0";
  if (val === "right") {
    if (defaultExpr.includes("w-text_w")) return "w-text_w";
    if (defaultExpr.includes("main_w-overlay_w")) return "main_w-overlay_w";
    return "0";
  }
  if (val === "top") return "0";
  if (val === "bottom") {
    if (defaultExpr.includes("h-text_h")) return "h-text_h";
    if (defaultExpr.includes("main_h-overlay_h")) return "main_h-overlay_h";
    return "0";
  }
  return null;
}

export function formatPosition(val: number | string | undefined, defaultExpr: string): string {
  if (val === undefined || val === "center") return defaultExpr;
  if (typeof val === "number") return String(val);

  const shorthand = parseShorthand(val);
  if (shorthand) {
    const base = resolveNamedPosition(shorthand.anchor, defaultExpr);
    if (base !== null) return `(${base})+(${shorthand.offset})`;
    return `(${defaultExpr})+(${shorthand.offset})`;
  }
  const named = resolveNamedPosition(val, defaultExpr);
  if (named !== null) return named;
  return val;
}

export function formatBasePosition(
  val: number | string | undefined,
  offset: number | undefined,
  defaultExpr: string
): string {
  const base = formatPosition(val, defaultExpr);
  if (offset === undefined || offset === 0) return base;
  return `(${base})+(${offset})`;
}

// ---------------------------------------------------------------------------
// Text-specific position helpers (support top-N / bottom-N shorthands)
// ---------------------------------------------------------------------------

export function formatTextPosition(val: number | string | undefined, defaultExpr: string): string {
  if (val === undefined || val === "center") return defaultExpr;
  if (typeof val === "number") return String(val);

  const bottom = val.match(/^bottom-(\d+(?:\.\d+)?)$/);
  if (bottom) return `h-text_h-${bottom[1]}`;

  const top = val.match(/^top-(\d+(?:\.\d+)?)$/);
  if (top) return top[1];

  const shorthand = parseShorthand(val);
  if (shorthand) {
    const base = resolveNamedPosition(shorthand.anchor, defaultExpr);
    if (base !== null) return `(${base})+(${shorthand.offset})`;
    return `(${defaultExpr})+(${shorthand.offset})`;
  }
  const named = resolveNamedPosition(val, defaultExpr);
  if (named !== null) return named;
  return val;
}

export function formatTextBasePosition(
  val: number | string | undefined,
  offset: number | undefined,
  defaultExpr: string
): string {
  const base = formatTextPosition(val, defaultExpr);
  if (offset === undefined || offset === 0) return base;
  return `(${base})+(${offset})`;
}
