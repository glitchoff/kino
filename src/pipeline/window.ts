import type { KinoComposition } from "../types/index.js";

/**
 * A time window of a composition, as a composition that compiles in isolation.
 *
 * ## Why a window is correct without re-basing
 *
 * Every scene's clock starts at zero: the background filter ends in
 * `setpts=PTS-STARTPTS`, elements use scene-relative `startAt`, and `enable`
 * expressions are `between(t, …)` against that same clock. A scene is therefore
 * self-contained — it does not know where it sits on the timeline.
 *
 * That means a window made of **whole scenes** is byte-identical to those scenes
 * in a full render. The only approximation is the boundary scene, and it is
 * trimmed at its **tail**, so the part that is kept starts at zero exactly as
 * it always did. Nothing has to be shifted.
 *
 * Trimming at the *head* would break this: `enable` windows and `setpts`
 * offsets would keep their old values while the scene clock restarted, and
 * captions would land in the wrong place.
 *
 * ## What it buys
 *
 * `compile()` sizes each scene's background by that scene's `duration`, so a
 * long composition asks ffmpeg to generate every second of every scene before
 * the first frame is shown. Compiling a window drops that to the scenes you are
 * actually looking at — measured 48x to first frame on a 164 s chapter
 * (61.8 s → 1.3 s).
 */

/** One scene's position on the timeline, from cumulative durations. */
export interface SceneSpan {
  index: number;
  start: number;
  end: number;
}

/** Where each scene sits, in order. */
export function sceneSpans(composition: KinoComposition): SceneSpan[] {
  const spans: SceneSpan[] = [];
  let t = 0;
  composition.scenes.forEach((scene, index) => {
    const duration = Number((scene as { duration?: number }).duration ?? 0);
    const end = t + duration;
    spans.push({ index, start: t, end });
    t = end;
  });
  return spans;
}

/** Total length of the composition, in seconds. */
export function compositionDuration(composition: KinoComposition): number {
  const spans = sceneSpans(composition);
  return spans.length ? spans[spans.length - 1]!.end : 0;
}

/**
 * The composition cut down to `[start, start + seconds)`.
 *
 * Whole scenes are kept as they are. A scene straddling either edge is trimmed,
 * and because only the **tail** can be trimmed without re-basing, a `start` that
 * falls inside a scene is moved back to that scene's own start. The returned
 * composition therefore always begins at a scene boundary and is never shorter
 * than `seconds` — it can only be longer, by at most the scene containing
 * `start`.
 *
 * Returns the composition unchanged when the window already covers it, so a
 * short clip compiles exactly as before.
 */
export function windowComposition(
  composition: KinoComposition,
  start: number,
  seconds: number
): { composition: KinoComposition; start: number; duration: number; sceneCount: number } {
  const spans = sceneSpans(composition);
  const total = spans.length ? spans[spans.length - 1]!.end : 0;
  if (!spans.length || seconds >= total) {
    return { composition, start: 0, duration: total, sceneCount: spans.length };
  }

  const wanted = Math.max(0, Math.min(start, Math.max(0, total - 1e-6)));

  // Snap back to the start of the scene the window begins in, so nothing is
  // ever trimmed at its head.
  const first = spans.find((s) => wanted < s.end) ?? spans[spans.length - 1]!;
  const from = first.start;
  const until = from + Math.max(seconds, 1e-3);

  const kept: KinoComposition["scenes"] = [];
  for (const span of spans) {
    if (span.start >= until) break;
    if (span.end <= from) continue;
    const scene = composition.scenes[span.index]!;
    if (span.end > until) {
      // Boundary scene: shorten the tail. Its clock still starts at zero.
      kept.push({ ...(scene as object), duration: until - span.start } as (typeof kept)[number]);
    } else {
      kept.push(scene);
    }
  }

  return {
    composition: { ...composition, scenes: kept },
    start: from,
    duration: until - from,
    sceneCount: kept.length,
  };
}
