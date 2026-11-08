import type { ColorAdjust } from "../../types/elements.js";

/**
 * Build the ffmpeg filters for a per-element colour adjustment.
 *
 * Order matters and is fixed: levels (lift/gain) → `eq` (brightness, contrast,
 * saturation, gamma) → `hue` rotation. Applying them in a different order per
 * element would make the same numbers look different on different clips.
 */
export function buildColorFilter(color: ColorAdjust | undefined): string | undefined {
  if (!color) return undefined;
  const filters: string[] = [];

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

    // Both are output ranges. `rimin`/`rimax` are *input* thresholds — lowering
    // `rimax` clips more of the image to white rather than darkening it, which
    // is the opposite of a gain.
    const parts: string[] = [];
    if (lift !== undefined) {
      parts.push(`romin=${lr}:gomin=${lg}:bomin=${lb}`);
    }
    if (gain !== undefined) {
      parts.push(`romax=${gr}:gomax=${gg}:bomax=${gb}`);
    }
    filters.push(`colorlevels=${parts.join(":")}`);
  }

  const eq: string[] = [];
  if (color.brightness !== undefined) eq.push(`brightness=${color.brightness}`);
  if (color.contrast !== undefined) eq.push(`contrast=${color.contrast}`);
  if (color.saturation !== undefined) eq.push(`saturation=${color.saturation}`);
  if (color.gamma !== undefined) eq.push(`gamma=${color.gamma}`);
  if (eq.length > 0) filters.push(`eq=${eq.join(":")}`);

  if (color.hue !== undefined && color.hue !== 0) {
    filters.push(`hue=h=${color.hue}`);
  }

  return filters.length > 0 ? filters.join(",") : undefined;
}

/** True when the adjustment would change nothing, so the filter can be skipped. */
export function isNeutralColor(color: ColorAdjust | undefined): boolean {
  if (!color) return true;
  const neutral =
    (color.brightness ?? 0) === 0 &&
    (color.contrast ?? 1) === 1 &&
    (color.saturation ?? 1) === 1 &&
    (color.hue ?? 0) === 0 &&
    (color.gamma ?? 1) === 1;
  if (!neutral) return false;
  const flat = (v: number | [number, number, number] | undefined, d: number) =>
    v === undefined || (Array.isArray(v) ? v.every((n) => n === d) : v === d);
  return flat(color.lift, 0) && flat(color.gain, 1);
}
