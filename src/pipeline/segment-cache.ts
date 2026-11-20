import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { NormalizedComposition, NormalizedScene } from "../types/index.js";

/**
 * Incremental rendering: cache each scene segment keyed by its content hash.
 *
 * A scene is not self-contained at its edges. A transition overlaps the two
 * scenes it joins — with `b` starting 1s before `a` ends, editing `b` changes
 * the last second of `a`'s picture. So the cache unit is a scene **plus its
 * incoming transition**, and editing scene N invalidates segment N *and*
 * segment N+1.
 *
 * That is the whole point: an edit re-renders two segments, never the timeline.
 *
 * Segments must encode identically for `-c copy` concat to work — same codec,
 * size, fps, pixel format, and a keyframe on frame 0.
 */

export interface Segment {
  /** Index in `norm.scenes`. */
  index: number;
  /** Scene id, for the log line and the file name. */
  id: string;
  /** Hash of everything that affects this segment's pixels. */
  hash: string;
  /** Where the rendered segment lives. */
  path: string;
  /** True when a previous render produced this exact segment. */
  cached: boolean;
}

/**
 * Hash of the inputs that decide a segment's picture.
 *
 * Deliberately includes the *previous* scene's tail, because an incoming
 * transition is composited from both sides. Two scenes that look identical but
 * sit after different neighbours must not share a cache entry.
 */
export function segmentHash(
  norm: NormalizedComposition,
  index: number
): string {
  const scene = norm.scenes[index];
  const prev = index > 0 ? norm.scenes[index - 1] : undefined;

  // Only the fields that reach the filtergraph. Encoder settings are excluded
  // on purpose: they are fixed per render (see `segmentArgs`), so a preset
  // change invalidates everything anyway and is not worth hashing per scene.
  const payload = {
    v: 1,
    width: norm.width,
    height: norm.height,
    fps: norm.fps,
    // The incoming transition is drawn from both scenes, so the previous
    // scene's id and duration are part of *this* segment's inputs.
    prev: prev ? { id: prev.id, duration: prev.duration } : null,
    scene: {
      id: scene.id,
      duration: scene.duration,
      background: scene.background,
      transition: scene.transition ?? null,
      elements: scene.elements,
    },
    grade: norm.grade ?? null,
  };

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

/** A segment's file name. Scene id keeps it readable while debugging. */
function segmentName(index: number, id: string, hash: string): string {
  const safe = id.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 40);
  return `${String(index).padStart(3, "0")}-${safe}-${hash}.mp4`;
}

/**
 * Plans the segments for a composition.
 *
 * Only valid when the composition has no transitions *or* when segments are cut
 * at transition boundaries. `canSegment` decides that; this assumes it was
 * checked.
 */
export function planSegments(
  norm: NormalizedComposition,
  cacheDir: string
): Segment[] {
  mkdirSync(cacheDir, { recursive: true });
  return norm.scenes.map((scene: NormalizedScene, index) => {
    const hash = segmentHash(norm, index);
    const path = join(cacheDir, segmentName(index, scene.id ?? `scene${index}`, hash));
    return {
      index,
      id: scene.id ?? `scene${index}`,
      hash,
      path,
      cached: existsSync(path),
    };
  });
}

/**
 * Whether a composition can be split into independently renderable segments.
 *
 * Transitions are the blocker: `selectScene()` drops them, so a scene rendered
 * alone has no fade. Until transition-aware segment rendering exists, a
 * composition with any transition falls back to a normal full render rather
 * than silently losing its fades.
 */
export function canSegment(norm: NormalizedComposition): { ok: boolean; reason?: string } {
  const withTransition = norm.scenes.filter((s) => s.transition);
  if (withTransition.length > 0) {
    return {
      ok: false,
      reason:
        `${withTransition.length} scene(s) have transitions, and a segment rendered alone ` +
        `has no neighbour to fade from. Render without transitions, or leave the cache off.`,
    };
  }
  return { ok: true };
}

/** A stable list of segment files for the concat demuxer. */
export function writeConcatList(segments: Segment[], path: string): void {
  // The concat demuxer wants `file '<path>'` with single quotes escaped.
  const body = segments
    .map((s) => `file '${s.path.replace(/'/g, "'\\''")}'`)
    .join("\n");
  writeFileSync(path, `${body}\n`, "utf8");
}

/** Records which segments produced an output, for debugging a stale render. */
export function writeSegmentManifest(segments: Segment[], path: string): void {
  writeFileSync(
    path,
    JSON.stringify(
      segments.map((s) => ({ id: s.id, hash: s.hash, cached: s.cached })),
      null,
      2
    ),
    "utf8"
  );
}
