# 027 — Incremental rendering: cache scene segments by hash

**Status:** in progress (2026-11-20) — `src/pipeline/segment-cache.ts` written,
not yet wired into `render()`. Blocked on transition handling (below).
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

**Cache unit: a scene plus its incoming transition.** Editing scene N therefore
invalidates segment N *and* segment N+1 — two segments, never the timeline.

## Status

- [x] `segmentHash()` — hashes the scene, its incoming transition, and the
      previous scene's id/duration (the fade needs both sides).
- [x] `planSegments()` — resolves cache paths, marks hits.
- [x] `canSegment()` — refuses when transitions are present, because
      `selectScene()` drops them and a segment rendered alone has no fade.
- [x] `writeConcatList()` / `writeSegmentManifest()`.
- [ ] Render each segment (`compile` + `render` per scene, `selectScene`).
- [ ] Concat with `-c copy`. Requires identical encode parameters and a
      **keyframe on frame 0** of every segment, or joins break.
- [ ] `cache: true` on `RenderOptions`, off by default.
- [ ] Transition-aware segments: render the fade as part of the *later*
      scene's segment by giving it the previous scene's tail.

## Open question

Until transition-aware segments exist, a composition with transitions gets no
cache benefit. That is most real clips. Either implement the tail-sharing above,
or accept per-scene caching only for transition-free compositions.
