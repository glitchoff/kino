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
  unit: string;
}

function parseShorthand(val: string): ShorthandParse | null {
  const match = val.match(/^(left|center|right|top|bottom)([+-]\d+(?:\.\d+)?)(px|%|pt)?$/i);
  if (!match) return null;
  return {
    anchor: match[1],
    offset: parseFloat(match[2]),
    unit: (match[3] || "").toLowerCase(),
  };
}

function getCanvasDimVar(defaultExpr: string): string {
  if (defaultExpr.includes("text_h")) return "h";
  if (defaultExpr.includes("overlay_h")) return "main_h";
  if (defaultExpr.includes("text_w")) return "w";
  if (defaultExpr.includes("overlay_w")) return "main_w";
  return "w";
}

function formatOffsetExpr(offset: number, unit: string, defaultExpr: string): string {
  if (unit === "%") {
    const canvasVar = getCanvasDimVar(defaultExpr);
    return `(${canvasVar}*(${offset}/100))`;
  }
  if (unit === "pt") {
    return String(Math.round(offset * (4 / 3)));
  }
  return String(offset);
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

  const strVal = String(val).trim();

  // Percentage value e.g. "50%"
  if (strVal.endsWith("%") && /^\d+(?:\.\d+)?%$/.test(strVal)) {
    const pct = parseFloat(strVal.slice(0, -1));
    if (Number.isFinite(pct)) {
      if (defaultExpr.includes("w-text_w") || defaultExpr.includes("main_w-overlay_w") || defaultExpr.includes("h-text_h") || defaultExpr.includes("main_h-overlay_h")) {
        return `(${defaultExpr})*(${pct}/100)`;
      }
      const canvasVar = getCanvasDimVar(defaultExpr);
      return `(${canvasVar}*(${pct}/100))`;
    }
  }

  // Pure px / pt strings e.g. "100px", "72pt"
  if (strVal.toLowerCase().endsWith("px")) {
    const px = parseFloat(strVal.slice(0, -2));
    if (Number.isFinite(px)) return String(px);
  }
  if (strVal.toLowerCase().endsWith("pt")) {
    const pt = parseFloat(strVal.slice(0, -2));
    if (Number.isFinite(pt)) return String(Math.round(pt * (4 / 3)));
  }

  const shorthand = parseShorthand(strVal);
  if (shorthand) {
    const base = resolveNamedPosition(shorthand.anchor, defaultExpr);
    const offsetExpr = formatOffsetExpr(shorthand.offset, shorthand.unit, defaultExpr);
    if (base !== null) return `(${base})+(${offsetExpr})`;
    return `(${defaultExpr})+(${offsetExpr})`;
  }
  const named = resolveNamedPosition(strVal, defaultExpr);
  if (named !== null) return named;
  return strVal;
}

export function formatBasePosition(
  val: number | string | undefined,
  offset: number | string | undefined,
  defaultExpr: string
): string {
  const base = formatPosition(val, defaultExpr);
  if (offset === undefined || offset === 0 || offset === "0" || offset === "0px") return base;

  let offsetExpr: string;
  if (typeof offset === "number") {
    offsetExpr = String(offset);
  } else {
    const strOff = String(offset).trim();
    if (strOff.endsWith("%")) {
      const pct = parseFloat(strOff.slice(0, -1));
      const canvasVar = getCanvasDimVar(defaultExpr);
      offsetExpr = `${canvasVar}*(${pct}/100)`;
    } else if (strOff.toLowerCase().endsWith("px")) {
      offsetExpr = String(parseFloat(strOff.slice(0, -2)));
    } else if (strOff.toLowerCase().endsWith("pt")) {
      offsetExpr = String(Math.round(parseFloat(strOff.slice(0, -2)) * (4 / 3)));
    } else {
      offsetExpr = strOff;
    }
  }

  return `(${base})+(${offsetExpr})`;
}

// ---------------------------------------------------------------------------
// Text-specific position helpers (support top-N / bottom-N shorthands)
// ---------------------------------------------------------------------------

export function formatTextPosition(val: number | string | undefined, defaultExpr: string): string {
  if (val === undefined || val === "center") return defaultExpr;
  if (typeof val === "number") return String(val);

  const strVal = String(val).trim();

  const bottom = strVal.match(/^bottom-(\d+(?:\.\d+)?)(px|%|pt)?$/i);
  if (bottom) {
    const num = parseFloat(bottom[1]);
    const unit = (bottom[2] || "").toLowerCase();
    if (unit === "%") {
      return `h-text_h-(h*(${num}/100))`;
    }
    const offset = unit === "pt" ? Math.round(num * (4 / 3)) : num;
    return `h-text_h-${offset}`;
  }

  const top = strVal.match(/^top-(\d+(?:\.\d+)?)(px|%|pt)?$/i);
  if (top) {
    const num = parseFloat(top[1]);
    const unit = (top[2] || "").toLowerCase();
    if (unit === "%") {
      return `h*(${num}/100)`;
    }
    const offset = unit === "pt" ? Math.round(num * (4 / 3)) : num;
    return String(offset);
  }

  return formatPosition(strVal, defaultExpr);
}

export function formatTextBasePosition(
  val: number | string | undefined,
  offset: number | string | undefined,
  defaultExpr: string
): string {
  const base = formatTextPosition(val, defaultExpr);
  if (offset === undefined || offset === 0 || offset === "0" || offset === "0px") return base;
  return formatBasePosition(base, offset, defaultExpr);
}
