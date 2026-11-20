import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { compile } from "./compile.js";
import { extractKino, readKinoManifest } from "../artifact/index.js";
import { normalizeComposition } from "../normalize/index.js";
import { getFFmpegBinaryPath } from "../encoder/probe.js";
import { resolveEncoderSync, buildEncoderFlags } from "./encoder-flags.js";
import type { KinoComposition, RenderOptions } from "../types/index.js";
import {
  planSegments,
  writeConcatList,
  writeSegmentManifest,
  type Segment,
} from "./segment-cache.js";
import { scratchDir } from "./scratch.js";

export interface CachedRenderResult {
  output: string;
  /** Segments reused from a previous run. */
  reused: number;
  /** Segments actually rendered this run. */
  rendered: number;
  segments: { id: string; cached: boolean }[];
}

/**
 * Renders a composition as independently cached scene segments, then joins them
 * with `-f concat -c copy`.
 *
 * The point is iteration: change one scene and only the segments containing it
 * are re-rendered. A transition makes a scene and its predecessor one unit (the
 * fade is drawn from both), so an edit invalidates at most two segments.
 *
 * `-c copy` only works when every segment encodes identically, so the encode
 * flags are computed once here and passed to every segment, and each segment is
 * forced to start on a keyframe.
 */
export function renderSegmented(
  composition: KinoComposition,
  options: RenderOptions,
  cacheDir: string
): CachedRenderResult {
  const norm = normalizeComposition(composition);
  const segments = planSegments(norm, cacheDir);
  const ffmpeg = getFFmpegBinaryPath(options.ffmpegPath);

  const encoder = resolveEncoderSync(options);
  const encoderFlags = buildEncoderFlags(encoder, options.preset, options.crf);
  // `-c copy` concat requires identical parameters in every segment, so these
  // are resolved once and reused rather than recomputed per segment.
  const fixed = [...encoderFlags, "-g", String(Math.round(norm.fps * 2))];

  const work = scratchDir("segments-", { outputPath: options.output, ram: options.ram });

  try {
    let rendered = 0;
    let reused = 0;

    for (const segment of segments) {
      if (segment.cached) {
        reused++;
        continue;
      }
      renderOneSegment(norm, segment, ffmpeg, fixed, work, options);
      rendered++;
    }

    const listPath = join(work, "concat.txt");
    writeConcatList(segments, listPath);
    writeSegmentManifest(segments, join(cacheDir, "manifest.json"));

    const out = resolve(options.output);
    mkdirSync(dirname(out), { recursive: true });
    const res = spawnSync(
      ffmpeg,
      [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "concat", "-safe", "0", "-i", listPath,
        "-c", "copy", out,
      ],
      { encoding: "utf8", timeout: 600_000 }
    );
    if (res.status !== 0) {
      throw new Error(
        `Failed to join segments:\n${(res.stderr || res.error?.message || "").trim()}`
      );
    }

    return {
      output: options.output,
      reused,
      rendered,
      segments: segments.map((s) => ({ id: s.id, cached: s.cached })),
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Renders one segment: the scene, plus its predecessor when a transition joins
 * them, cut to the slice the segment owns.
 */
function renderOneSegment(
  norm: ReturnType<typeof normalizeComposition>,
  segment: Segment,
  ffmpeg: string,
  encoderFlags: string[],
  work: string,
  options: RenderOptions
): void {
  // Build a composition containing only the scenes this segment needs, with
  // their original timing so the transition geometry is unchanged.
  // Build a composition containing only the scenes this segment needs. Their
  // original *relative* timing is preserved so the transition geometry matches
  // the full render; the first scene is rebased to zero.
  const wanted = new Set(segment.renderIndices);
  const firstIndex = Math.min(...segment.renderIndices);
  const baseStart = Number(norm.scenes[firstIndex]?.startTime ?? 0);
  const sub = {
    ...norm,
    scenes: norm.scenes
      .filter((_, i) => wanted.has(i))
      .map((scene, i) => ({
        ...scene,
        // The first scene of a sub-composition has no predecessor to fade from,
        // so it must not carry a transition. Only the *later* scene's incoming
        // transition is wanted here — that is the one this segment renders.
        transition: i === 0 ? undefined : scene.transition,
        startTime: Number(scene.startTime ?? 0) - baseStart,
      })),
  } as unknown as KinoComposition;

  const segDir = join(work, `seg-${segment.index}`);
  mkdirSync(segDir, { recursive: true });
  const kinoPath = join(segDir, "segment.kino");

  compile(sub, {
    ...options,
    kinoPath,
    // Segments must not inherit a preview height, or `-c copy` joins a preview
    // to a full render. Preview renders whole compositions, not segments.
    preview: undefined,
  });

  const extractDir = join(segDir, "extract");
  mkdirSync(extractDir, { recursive: true });
  extractKino(kinoPath, extractDir);
  const manifest = readKinoManifest(kinoPath);

  // Drop the compile-time output and encode flags; this run supplies its own so
  // every segment matches byte-for-byte in codec parameters.
  const args = stripOutputAndEncode(manifest.ffmpegArgs);
  const target = join(segDir, basename(segment.path));

  const full = [
    ...args,
    ...encoderFlags,
    // Seek and trim after decode so the transition is already composited; the
    // slice starts on a keyframe because `-g` above forces one every 2s and the
    // concat demuxer needs a clean start.
    "-ss", String(segment.offset),
    "-t", String(segment.duration),
    target,
  ];

  const res = spawnSync(ffmpeg, full, {
    encoding: "utf8",
    timeout: 900_000,
    cwd: extractDir,
  });
  if (res.status !== 0) {
    throw new Error(
      `Segment '${segment.id}' failed:\n${(res.stderr || res.error?.message || "").trim()}`
    );
  }

  // Move into the cache only once it is complete, so an interrupted render
  // never leaves a truncated segment that a later run trusts.
  copyFileSync(target, segment.path);
  writeFileSync(`${segment.path}.done`, "", "utf8");
}

/**
 * Removes the output path and any encode flags from a manifest's args.
 *
 * The manifest ends with `… -c:v … <output>`; the caller re-adds its own flags
 * so all segments match.
 */
function stripOutputAndEncode(args: string[]): string[] {
  const cut = args.findIndex((a) => a === "-c:v" || a === "-c:a");
  const withoutEncode = cut >= 0 ? args.slice(0, cut) : args.slice(0, -1);
  return withoutEncode;
}
