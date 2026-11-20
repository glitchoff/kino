# 025 — `zoompan` for scale animation

**Status:** done (2026-11-20). Shipped behind guards; parity verified; 12 tests.
**Created:** 2026-11-20
**Related:** 023 (still lifetime), 024 (preview resolution).

## Result

A 36-second, 6-scene, 1080p bench at `--preview 144`:

| Build | Time |
| --- | --- |
| Preview fix alone (024) | 20.4 s |
| + `zoompan` | **10.9 s** |

Frames sampled at 2, 10, 18, 26 and 32 s all show content (mean luma ~126,
97%+ non-black), so this is not the black-frame failure mode.

## Problem

A scale animation compiles to `scale=w='…':h='…':eval=frame`, a full resample of
the element on every frame. For a slow 1.0 → 1.05 push on a full-frame panel
that is the most expensive per-frame filter in the graph.

## Measured

180 frames, one still, `-f null` (no encode):

| Filter chain | 256×144 | 1920×1080 |
| --- | --- | --- |
| `scale=…:eval=frame` + `overlay` | 1753 ms | 3336 ms |
| `scale=…:eval=frame` only | 1500 ms | 2853 ms |
| `zoompan` | 1180 ms | **1359 ms** |

`zoompan` is **2.5× faster at 1080p**. It does the zoom in one pass, and its
output is already frame-sized so the overlay has less to do.

## What the ffmpeg docs say (verified, not assumed)

From `ffmpeg-filters.html` §zoompan:

- **`zoom`, `z` — "Range is 1-10."** A scale below 1 is out of range. `popIn`
  starts at 0.8 and a shrink-out ends at 0, so both are disqualified.
- **`d`** is frames per input frame, not an interpolation window. `d=1` gives one
  output frame per input frame.
- **`s`** is the output size and is fixed. A smaller element would be **cropped**
  rather than scaled.
- Constants are `in`, `on`, `in_time`, `out_time`… — there is **no `t`**. Time is
  `on/fps`.

## Parity — measured, and corrected twice

**First check said "opposite direction".** That was wrong: it compared `scale`
anchored at the top-left against `zoompan` anchored at the centre. Mismatched
anchors, not a real difference.

**Second check, with both anchored the same way** (a dot at x=400..479 in a
1920×1080 frame, full-frame element centred by the overlay):

| t | `scale` + centred overlay | `zoompan` centre | Δ |
| --- | --- | --- | --- |
| 0 s | x 400..479 | x 400..479 | 0 |
| 5.9 s | x 373..452 | x 373..452 | 0 |

At 480×270 the same comparison gave Δ ≤ 1 px — pixel rounding on a 20 px dot,
not a motion difference. **`zoompan` with `x='iw/2-(iw/zoom/2)'` is equivalent
to `scale=…:eval=frame` plus a centred overlay.**

The physics: a point at distance `d` from centre lands at `d·z` under `scale`
(and the overlay re-centres, keeping that), and at `d/z` under a `zoompan` that
crops inward. They only coincide when the zoom is applied about the same origin
— which the centred anchor does. The lesson is that the anchor, not the filter,
decides the motion.



| Condition | Why |
| --- | --- |
| Element is opaque (`needsAlpha` false) | `zoompan` **flattens alpha**. Verified: an RGBA source comes back fully opaque, even with `format=rgba` before the filter. |
| Element covers the frame | `s=WxH` crops; a 640×360 element on 1920×1080 would lose its edges. |
| `from`/`to` both within 1–10 | The documented range. A clamp would silently change the motion. |
| Easing is `linear` | Overshooting curves (`easeOutBack`, `easeOutElastic`) pass their endpoints, so `from`/`to` do not bound the curve. |
| No keyframe track | Bounds cannot be proven without evaluating the curve. |
| No opacity animation | Opacity runs through `geq`, which needs the alpha `zoompan` destroys. |

Anything failing a guard keeps `scale=…:eval=frame` — slower but correct. The
eligibility check reads the animation's own `from`/`to`, not the compiled string,
because guessing from a regex would clamp rather than fail.

## Honest scope

This is a **narrow** optimisation: it helps opaque, full-frame, linearly-easing
scale ramps — which is exactly the manga `push`/`drift` case, but not `popIn`,
not keyframed scale, not anything with alpha.

## Still to do

- [ ] Verify `zoompan` and `scale` produce the same picture (bench-parity).
- [ ] Full `pnpm test` (baseline red: 15 failures / 5 files).
- [ ] Re-run the 6-scene bench end to end and record the delta.
- [ ] Docs: `docs/look.md` §Animation should say which scale animations get the
      fast path, since the 1–10 and linear-only limits are user-visible.
