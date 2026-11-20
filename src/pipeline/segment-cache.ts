import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { NormalizedComposition } from "../types/index.js";

/**
 * Incremental rendering: cache each scene segment keyed by its content hash.
 *
 * **A transition makes a scene and its predecessor one unit.** Scene B starts
 * inside scene A when a fade joins them, so B's first frames are A fading out.
 * A segment therefore renders the *pair* and keeps the slice that belongs to
 * the later scene:
 *
 * ```
 * a  start 0     dur 4
 * b  start 3     dur 4      ← b begins 1s before a ends
 * c  start 6.5   dur 4
 *
 * segment a  = a alone                     (no incoming transition)
 * segment b  = a+b, keep [3, 7)            (the fade lives in this slice)
 * segment c  = b+c, keep [6.5, 10.5)
 * ```
 *
 * The kept slices abut exactly, so `-f concat -c copy` reproduces the timeline.
 * Editing scene N invalidates segment N and segment N+1 — never the timeline.
 */

export interface Segment {
  /** Index in `norm.scenes` — the scene this segment *produces*. */
  index: number;
  /** Scene id, for logs and file names. */
  id: string;
  /** Hash of everything that affects this segment's pixels. */
  hash: string;
  /** Where the rendered segment lives. */
  path: string;
  /** True when a previous render produced this exact segment. */
  cached: boolean;
  /** Scenes rendered together for this segment: `[index]` or `[index-1, index]`. */
  renderIndices: number[];
  /** Seconds to seek into the rendered pair before keeping frames. */
  offset: number;
  /** Seconds to keep from the pair. */
  duration: number;
}

/**
 * Hash of the inputs that decide a segment's picture.
 *
 * Includes the previous scene when a transition joins them, because that scene
 * is physically rendered into the same segment.
 */
export function segmentHash(norm: NormalizedComposition, index: number): string {
  const scene = norm.scenes[index];
  const prev = index > 0 ? norm.scenes[index - 1] : undefined;
  const joined = !!scene.transition && !!prev;

  const payload = {
    v: 2,
    width: norm.width,
    height: norm.height,
    fps: norm.fps,
    grade: norm.grade ?? null,
    // Only include the previous scene when it is actually rendered here.
    prev: joined
      ? {
          id: prev!.id,
          duration: prev!.duration,
          background: prev!.background,
          elements: prev!.elements,
        }
      : null,
    scene: {
      id: scene.id,
      duration: scene.duration,
      background: scene.background,
      transition: scene.transition ?? null,
      elements: scene.elements,
    },
  };

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

/** A segment's file name. Scene id keeps it readable while debugging. */
function segmentName(index: number, id: string, hash: string): string {
  const safe = id.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 40);
  return `${String(index).padStart(3, "0")}-${safe}-${hash}.mp4`;
}

/** Plans every segment for a composition, marking cache hits. */
export function planSegments(norm: NormalizedComposition, cacheDir: string): Segment[] {
  mkdirSync(cacheDir, { recursive: true });
  const scenes = norm.scenes;
  const total = Number(norm.duration ?? 0);

  return scenes.map((scene, index) => {
    const prev = index > 0 ? scenes[index - 1] : undefined;
    const joined = !!scene.transition && !!prev;

    // The slice this segment owns is [start_i, start_{i+1}): from where this
    // scene becomes the incoming one to where the next scene takes over. The
    // slices abut exactly, so concatenating them reproduces the timeline.
    const ownStart = Number(scene.startTime ?? 0);
    const ownEnd =
      index + 1 < scenes.length
        ? Number(scenes[index + 1].startTime ?? 0)
        : total;

    // A joined segment renders from the previous scene's start so the fade is
    // physically present in the encoded file, then discards everything before
    // its own start.
    const renderStart = joined ? Number(prev!.startTime ?? 0) : ownStart;

    const hash = segmentHash(norm, index);
    const id = scene.id ?? `scene${index}`;
    const path = join(cacheDir, segmentName(index, id, hash));

    return {
      index,
      id,
      hash,
      path,
      cached: existsSync(path),
      renderIndices: joined ? [index - 1, index] : [index],
      offset: Math.max(0, ownStart - renderStart),
      duration: Math.max(0.04, ownEnd - ownStart),
    };
  });
}

/**
 * Whether a composition can be split into segments at all.
 *
 * Anything can now, including transitions, because a segment renders its
 * predecessor alongside it. This exists so callers can skip the machinery when
 * there is only one scene, where caching cannot help.
 */
export function canSegment(norm: NormalizedComposition): { ok: boolean; reason?: string } {
  if (norm.scenes.length < 2) {
    return { ok: false, reason: "a single-scene composition has nothing to cache" };
  }
  return { ok: true };
}

/**
 * A stable list of segment files for the concat demuxer.
 *
 * Paths are made **absolute** on the way in. The concat file lives in a scratch
 * directory while the segments live in the cache directory, and ffmpeg resolves
 * `file` entries relative to the list, not the caller's cwd — so a relative
 * segment path silently points at a file that does not exist. Windows paths also
 * need forward slashes: the concat demuxer treats a backslash as an escape.
 */
export function writeConcatList(segments: Segment[], path: string): void {
  const body = segments
    .map((s) => {
      const abs = resolve(s.path).replace(/\\/g, "/");
      return `file '${abs.replace(/'/g, "'\\''")}'`;
    })
    .join("\n");
  writeFileSync(path, `${body}\n`, "utf8");
}

/** Records which segments produced an output, for debugging a stale render. */
export function writeSegmentManifest(segments: Segment[], path: string): void {
  writeFileSync(
    path,
    JSON.stringify(
      segments.map((s) => ({ id: s.id, hash: s.hash, cached: s.cached, offset: s.offset })),
      null,
      2
    ),
    "utf8"
  );
}

/** Reads a previous manifest, for reporting what changed between runs. */
export function readSegmentManifest(path: string): { id: string; hash: string }[] | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}
