import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getFFmpegBinaryPath } from "../../encoder/probe.js";

/**
 * Rasterise a shape to a PNG at compile time.
 *
 * Shapes are static, so drawing them once is cheap and needs no browser — which
 * is the point. Agents were faking rectangles and circles with `html` elements,
 * which pulls in Chrome or Obscura, costs a page render per element, and lays
 * out slightly differently between the two engines.
 *
 * The output is an ordinary PNG that the existing image path overlays, so there
 * is no second rendering model.
 */

export interface ShapeRaster {
  /** PNG path. */
  path: string;
  width: number;
  height: number;
}

interface RasterOptions {
  /** Output PNG path. */
  out: string;
  width: number;
  height: number;
  /** Directory for the intermediate `.txt` files drawtext needs. */
  workDir: string;
  ffmpegPath?: string;
}

/** `#rrggbb` → `0xrrggbb`, and `transparent`/`none` → alpha 0. */
function toFfmpegColor(color: string | undefined, fallback = "0xffffff"): string {
  if (!color || color === "transparent" || color === "none") return "0x000000@0.0";
  const c = color.trim();
  if (c.startsWith("#")) {
    const hex = c.slice(1);
    if (hex.length === 3) return `0x${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
    return `0x${hex}`;
  }
  return c;
}

function isTransparent(color: string | undefined): boolean {
  return !color || color === "transparent" || color === "none";
}

/** Run ffmpeg and throw with its stderr, which is where the real reason is. */
function run(args: string[], what: string): void {
  const res = spawnSync(args[0], args.slice(1), { encoding: "utf8" });
  if (res.status !== 0) {
    const detail = res.stderr?.trim() || res.error?.message || `exit code ${res.status}`;
    throw new Error(`Failed to rasterise ${what}: ${detail}`);
  }
}

/**
 * A rounded rectangle, drawn with `geq`.
 *
 * `drawbox` cannot round corners and, worse, does not raise alpha — drawing
 * boxes onto a transparent canvas gives a fully transparent image with the
 * right colour in it. `geq` writes every channel including alpha.
 */
function roundedRectMask(opts: RasterOptions, radius: number, fill: string): void {
  const { out, width, height, ffmpegPath } = opts;
  const bin = ffmpegPath ?? getFFmpegBinaryPath();
  const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));

  // Distance into the corner region, only counted when the pixel is in a
  // corner. Inside the straight edges the test is trivially true.
  const cx = `min(max(X,${r}),${width - r})`;
  const cy = `min(max(Y,${r}),${height - r})`;
  const inside = `lte(pow(X-${cx},2)+pow(Y-${cy},2),${r * r})`;

  const [fr, fg, fb, fa] = parseColor(fill);
  const geq = [
    `r='if(${inside},${fr},0)'`,
    `g='if(${inside},${fg},0)'`,
    `b='if(${inside},${fb},0)'`,
    `a='if(${inside},${Math.round(fa * 255)},0)'`,
  ].join(":");

  run(
    [bin, "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", `color=c=0x000000@0.0:s=${width}x${height}:d=1,format=rgba`,
      "-vf", `geq=${geq}`, "-frames:v", "1", out],
    "rounded rect"
  );
}

/** `0xrrggbb` / `0xrrggbb@a` → [r, g, b, a]. Unparseable falls back to white. */
function parseColor(c: string): [number, number, number, number] {
  const m = /^0x([0-9a-f]{6})(?:@([0-9.]+))?$/i.exec(c);
  if (!m) return [255, 255, 255, 1];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseFloat(m[2]) : 1];
}

/** Draw a rectangle, optionally rounded, with an optional stroke. */
export function rasterRect(opts: RasterOptions, spec: {
  fill?: string;
  radius?: number;
  stroke?: string;
  strokeWidth?: number;
}): void {
  const { out, width, height, workDir, ffmpegPath } = opts;
  const bin = ffmpegPath ?? getFFmpegBinaryPath();
  const radius = spec.radius ?? 0;
  const strokeWidth = spec.strokeWidth ?? 0;
  const hasFill = !isTransparent(spec.fill);

  if (radius > 0) {
    roundedRectMask(opts, radius, hasFill ? spec.fill! : (spec.stroke ?? "#ffffff"));
    return;
  }

  // The source carries the fill colour, not a transparent canvas: `drawbox`
  // writes RGB but does not raise alpha, so drawing a fill onto an alpha-0
  // source produces a fully transparent image with the right colour in it.
  const source = hasFill
    ? `color=c=${toFfmpegColor(spec.fill)}:s=${width}x${height}:d=1,format=rgba`
    : `color=c=0x000000@0.0:s=${width}x${height}:d=1,format=rgba`;

  // A stroke has to write alpha as well as colour, which `drawbox` does not do
  // on a transparent canvas. `geq` handles both fill and ring in one pass.
  if (spec.stroke && strokeWidth > 0) {
    const [fr, fg, fb, fa] = parseColor(hasFill ? toFfmpegColor(spec.fill) : "0x000000@0");
    const [sr, sg, sb, sa] = parseColor(toFfmpegColor(spec.stroke));
    const inner = `gte(X,${strokeWidth})*gte(Y,${strokeWidth})*lte(X,${width - strokeWidth - 1})*lte(Y,${height - strokeWidth - 1})`;
    const chan = (name: string, fv: number, sv: number) =>
      `${name}='if(${inner},${fv},${sv})'`;
    const geq = [
      chan("r", fr, sr),
      chan("g", fg, sg),
      chan("b", fb, sb),
      chan("a", hasFill ? Math.round(fa * 255) : 0, Math.round(sa * 255)),
    ].join(":");
    run(
      [bin, "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", `color=c=0x000000@0.0:s=${width}x${height}:d=1,format=rgba`,
        "-vf", `geq=${geq}`, "-frames:v", "1", out],
      "rect stroke"
    );
    return;
  }

  run(
    [bin, "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", source,
      "-frames:v", "1", out],
    "rect"
  );
  void workDir;
}

/** Draw an ellipse filling the box, with an optional stroke. */
export function rasterEllipse(opts: RasterOptions, spec: {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}): void {
  const { out, width, height, ffmpegPath } = opts;
  const bin = ffmpegPath ?? getFFmpegBinaryPath();
  const rx = width / 2;
  const ry = height / 2;
  const strokeWidth = spec.strokeWidth ?? 0;

  // `geq` evaluates per pixel; a squared-distance test against the radii gives
  // an accurate disc.
  const inside = `lte(pow((X-${rx})/${rx},2)+pow((Y-${ry})/${ry},2),1)`;
  // With no stroke the whole interior is fill, so `inner` must be true
  // everywhere inside — "0" here inverted the test and made every pixel take
  // the (transparent) stroke branch.
  const inner =
    strokeWidth > 0
      ? `lte(pow((X-${rx})/${Math.max(1, rx - strokeWidth)},2)+pow((Y-${ry})/${Math.max(1, ry - strokeWidth)},2),1)`
      : "1";

  const fill = toFfmpegColor(spec.fill);
  const stroke = toFfmpegColor(spec.stroke);

  // Build per-channel expressions: fill inside, stroke on the ring.
  const chan = (name: string, fillV: string, strokeV: string) =>
    `${name}='if(${inside},if(${inner},${fillV},${strokeV}),0)'`;

  const [fr, fg, fb, fa] = parseColor(fill);
  const [sr, sg, sb, sa] = parseColor(stroke);

  const geq = [
    chan("r", String(fr), String(sr)),
    chan("g", String(fg), String(sg)),
    chan("b", String(fb), String(sb)),
    chan("a", String(fa * 255), String(strokeWidth > 0 ? sa * 255 : 0)),
  ].join(":");

  run(
    [bin, "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", `color=c=0x000000@0.0:s=${width}x${height}:d=1,format=rgba`,
      "-vf", `geq=${geq}`, "-frames:v", "1", out],
    "ellipse"
  );
}

/** Draw a line between two points inside the box, with a thickness. */
export function rasterLine(opts: RasterOptions, spec: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke?: string;
  strokeWidth?: number;
}): void {
  const { out, width, height, ffmpegPath } = opts;
  const bin = ffmpegPath ?? getFFmpegBinaryPath();
  const w = spec.strokeWidth ?? 2;
  const color = toFfmpegColor(spec.stroke);

  // `drawbox` cannot rotate; a straight line is a thin rectangle rotated by
  // nothing only if it is axis-aligned. For arbitrary angles, draw with `geq`:
  // the distance from the segment.
  const { x1, y1, x2, y2 } = spec;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  // Projection parameter t, clamped to the segment, then distance to the point.
  const t = `min(max(((X-${x1})*${dx}+(Y-${y1})*${dy})/${len2},0),1)`;
  const dist = `hypot(X-(${x1}+${dx}*${t}),Y-(${y1}+${dy}*${t}))`;
  const inside = `lte(${dist},${w / 2})`;

  const m = /^0x([0-9a-f]{6})(?:@([0-9.]+))?$/i.exec(color);
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  const alpha = m && m[2] ? parseFloat(m[2]) : 1;

  const geq = [
    `r='if(${inside},${(n >> 16) & 255},0)'`,
    `g='if(${inside},${(n >> 8) & 255},0)'`,
    `b='if(${inside},${n & 255},0)'`,
    `a='if(${inside},${alpha * 255},0)'`,
  ].join(":");

  run(
    [bin, "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", `color=c=0x000000@0.0:s=${width}x${height}:d=1,format=rgba`,
      "-vf", `geq=${geq}`, "-frames:v", "1", out],
    "line"
  );
}
