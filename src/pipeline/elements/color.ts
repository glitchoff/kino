import type { ColorAdjust, CurvePoints, CurveSet } from "../../types/elements.js";

/**
 * The order a grade is applied in, and it is fixed.
 *
 * 1. **LUT** — a look is a mapping from the whole colour volume; running it
 *    first means the numbers after it describe the graded image, which is what
 *    a colourist expects. Running it last would apply a look to values the LUT
 *    was never designed for.
 * 2. **Curves** — tonal shaping per channel, after the look is in place.
 * 3. **Levels** — lift/gain, the black and white points.
 * 4. **Balance** — shadows/mids/highlights colour, which reads off the levels
 *    above it.
 * 5. **eq** — brightness, contrast, saturation, gamma.
 * 6. **hue** — rotation, last, so it rotates the finished image.
 *
 * Two grades that list the same numbers in a different order look different, so
 * this order is the contract: element grades and the composition grade both go
 * through here.
 */
export function buildColorFilter(
  color: ColorAdjust | undefined,
  /** Resolve a LUT path to something ffmpeg can open (usually a staged file). */
  stageAsset?: (src: string) => string
): string | undefined {
  if (!color) return undefined;
  const filters: string[] = [];

  // 1. LUT
  if (color.lut) {
    const file = stageAsset ? stageAsset(color.lut) : color.lut;
    const interp = color.lutInterp ?? "tetrahedral";
    filters.push(`lut3d=file='${escapePath(file)}':interp=${interp}`);
  }

  // 2. Curves
  const curveFilter = buildCurvesFilter(color.curves);
  if (curveFilter) filters.push(curveFilter);

  // 3. Levels — lift and gain are output black and white points.
  const lift = color.lift;
  const gain = color.gain;
  if (lift !== undefined || gain !== undefined) {
    // `colorlevels` has input and output ranges, and it is easy to reach for the
    // wrong pair: `rimin` sets the *input* black point (everything below it
    // clips to black), which does not lift anything. Raising blacks means
    // raising the *output* floor, `romin`.
    const asTriple = (v: number | [number, number, number] | undefined, d: number): [number, number, number] =>
      v === undefined ? [d, d, d] : Array.isArray(v) ? v : [v, v, v];

    const [lr, lg, lb] = asTriple(lift, 0);
    const [gr, gg, gb] = asTriple(gain, 1);

    const parts: string[] = [];
    if (lift !== undefined) {
      parts.push(`romin=${lr}:gomin=${lg}:bomin=${lb}`);
    }
    if (gain !== undefined) {
      parts.push(`romax=${gr}:gomax=${gg}:bomax=${gb}`);
    }
    filters.push(`colorlevels=${parts.join(":")}`);
  }

  // 4. Balance
  if (color.balance) {
    const b = color.balance;
    // ffmpeg names these channel-then-band: `rs` is red-shadows, `bm` is
    // blue-midtones. Band-first (`sr`) is not an option and fails outright.
    const parts: string[] = [];
    const push = (band: "s" | "m" | "h", triple: [number, number, number] | undefined) => {
      if (!triple) return;
      parts.push(`r${band}=${triple[0]}`, `g${band}=${triple[1]}`, `b${band}=${triple[2]}`);
    };
    push("s", b.shadows);
    push("m", b.midtones);
    push("h", b.highlights);
    if (b.preserveLightness) parts.push("pl=1");
    if (parts.length > 0) filters.push(`colorbalance=${parts.join(":")}`);
  }

  // 5. eq
  const eq: string[] = [];
  if (color.brightness !== undefined) eq.push(`brightness=${color.brightness}`);
  if (color.contrast !== undefined) eq.push(`contrast=${color.contrast}`);
  if (color.saturation !== undefined) eq.push(`saturation=${color.saturation}`);
  if (color.gamma !== undefined) eq.push(`gamma=${color.gamma}`);
  if (eq.length > 0) filters.push(`eq=${eq.join(":")}`);

  // 6. hue
  if (color.hue !== undefined && color.hue !== 0) {
    filters.push(`hue=h=${color.hue}`);
  }

  return filters.length > 0 ? filters.join(",") : undefined;
}

/**
 * Build a `curves` filter from control points.
 *
 * ffmpeg's point syntax is `in/out in/out …` with values in 0..1, and it
 * *requires* the first point to be at 0 and the last at 1. Callers are allowed
 * to omit either, so they are filled in here rather than rejected — a curve
 * from `[0.5, 0.7]` alone is a perfectly reasonable thing to ask for.
 */
export function buildCurvesFilter(curves: CurveSet | undefined): string | undefined {
  if (!curves) return undefined;

  const parts: string[] = [];
  const named: Array<["master" | "red" | "green" | "blue", string, CurvePoints | undefined]> = [
    ["master", "master", curves.master],
    ["red", "red", curves.red],
    ["green", "green", curves.green],
    ["blue", "blue", curves.blue],
  ];

  for (const [, ffmpegName, points] of named) {
    const expr = curvePointsExpression(points);
    if (expr) parts.push(`${ffmpegName}='${expr}'`);
  }

  return parts.length > 0 ? `curves=${parts.join(":")}` : undefined;
}

/**
 * Turn `[[0, 0], [0.5, 0.7], [1, 1]]` into `0/0 0.5/0.7 1/1`.
 *
 * Sorted by input, because a curve is a function and out-of-order points would
 * either be rejected or silently reordered. Endpoints are added when missing so
 * the untouched parts of the range pass through unchanged.
 */
export function curvePointsExpression(points: CurvePoints | undefined): string | undefined {
  if (!points || points.length === 0) return undefined;

  const sorted = [...points].map(([x, y]) => [clamp01(x), clamp01(y)] as [number, number]);
  sorted.sort((a, b) => a[0] - b[0]);

  if (sorted[0][0] > 0) sorted.unshift([0, 0]);
  if (sorted[sorted.length - 1][0] < 1) sorted.push([1, 1]);

  return sorted.map(([x, y]) => `${trim(x)}/${trim(y)}`).join(" ");
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/** Shortest decimal that round-trips, so the graph stays readable. */
function trim(v: number): string {
  return String(Number(v.toFixed(4)));
}

/** Escape a path for use inside a filter argument. */
function escapePath(path: string): string {
  // A colon separates filter options and a backslash escapes, so both need
  // handling; single quotes around the value cover the rest.
  return path.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/** True when the adjustment would change nothing, so the filter can be skipped. */
export function isNeutralColor(color: ColorAdjust | undefined): boolean {
  if (!color) return true;
  const neutral =
    (color.brightness ?? 0) === 0 &&
    (color.contrast ?? 1) === 1 &&
    (color.saturation ?? 1) === 1 &&
    (color.hue ?? 0) === 0 &&
    (color.gamma ?? 1) === 1 &&
    color.lut === undefined &&
    color.curves === undefined &&
    color.balance === undefined;
  if (!neutral) return false;
  const flat = (v: number | [number, number, number] | undefined, d: number) =>
    v === undefined || (Array.isArray(v) ? v.every((n) => n === d) : v === d);
  return flat(color.lift, 0) && flat(color.gain, 1);
}
