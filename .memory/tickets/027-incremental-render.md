# 027 — Incremental rendering: cache scene segments by hash

**Status:** done (2026-11-20). `cache: true` renders scene segments, reuses
unchanged ones, joins with `-f concat -c copy`.
**Created:** 2026-11-20
**Requested as:** "useBuildCache or similar flag so we can do edits faster".

## Problem

Every edit re-renders the whole composition. On a 3–4 minute clip that is
minutes per iteration, even when one scene changed.

## Design

Split the timeline into segments, hash each by content, reuse unchanged
segments, join with `-f concat -c copy` (no re-encode).

**The hard part is transitions.** A transition overlaps its two scenes:

```
a  start 0     dur 4
b  start 3     dur 4      ← b begins 1s before a ends
c  start 6.5   dur 4      ← c begins 0.5s before b ends
total 10.5
```

So a scene is **not self-contained at its edges**. Editing `b` changes the last
second of `a`'s picture, because that second is `a` fading into `b`.

**Resolution — "adjacent scene".** A segment is a scene *plus its incoming
transition*, and the transition is drawn from both scenes. So a joined segment
renders the pair `[i-1, i]` together and keeps only the slice it owns. The fade
is physically present in the encoded file before the cut, so nothing needs to
share tails between separately rendered files.

**Cache unit: a scene plus its incoming transition.** Editing scene N therefore
invalidates segment N *and* segment N+1 — two segments, never the timeline.

### Slicing

Segment `i` owns `[start_i, start_{i+1})` — the region where scene `i` is the
incoming one. The last segment owns `[start_n, total]`. The slices abut exactly,
so the concatenation reproduces the timeline with no gap and no double-count.

A joined segment renders from `prev.startTime` and discards `offset =
ownStart - renderStart` seconds, which is exactly the previous scene's tail.

### Correctness requirements

- **Identical encode parameters** in every segment, or `-c copy` joins garbage.
  Resolved once in `renderSegmented` and passed to every segment.
- **A keyframe on frame 0** of every segment. `-g fps*2` forces regular
  keyframes; the concat demuxer needs a clean start at each boundary.
- **The sub-composition's first scene must not carry a transition** — it has no
  predecessor to fade from, and validation rejects it. The later scene keeps
  its transition; that is the one the segment exists to render.
- **Timing is rebased relative to the pair**, not zeroed, so transition geometry
  inside a segment matches the full render.

## Status

- [x] `segmentHash()` — hashes the scene, its incoming transition, and the
      previous scene when the two are rendered together.
- [x] `planSegments()` — resolves cache paths, marks hits, computes the slice.
- [x] `renderSegmented()` — per-segment compile + encode + concat.
- [x] `cache: true` / `cacheDir` on `RenderOptions`, off by default.
- [x] Transition-aware segments (the pair render above).

## Measured

Synthetic 3-scene probe, 640×360, 30 fps, 2 s scenes, 0.4 s fades:

| Run | Reused | Rendered | Time |
| --- | --- | --- | --- |
| cold | 0 | 3 | 4719 ms |
| no edit | 3 | 0 | 704 ms |
| edit scene 2 | 1 | 2 | — |

Output verified by frame hash: 156 frames (5.2 s, matching 2 + 1.6 + 1.6), and
the three slices hash differently, so the join is real and not a duplicated
scene.

**No number exists for a real composition.** Per `AGENTS.md`, do not quote a
speedup for Paper Ghost until it is measured there.

## Known limits

- Not compatible with `preview` — a preview composites at a smaller frame, and
  joining a preview segment to a full one would break the concat.
- A one-shot render is *slower* with the cache (extra per-segment ffmpeg runs
  plus a concat pass). It only pays off on the second and later renders.
- The cache never garbage-collects. Old hashes accumulate in `cacheDir`; delete
  the directory to reclaim space.
