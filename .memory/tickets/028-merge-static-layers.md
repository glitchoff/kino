# 028 — Merge static layers into one pre-composited overlay per scene

**Status:** proposed (2026-11-20). Not started.
**Created:** 2026-11-20
**Requested as:** "One overlay chain per scene, not per layer: merge static
layers into a single pre-composited PNG first."

## Problem

Every element becomes its own ffmpeg input and its own `overlay` pass. A scene
with a background block, three texts and a panel runs four overlays per frame.
ffmpeg's `overlay` is a full-frame composite, so the cost is linear in the
number of layers and does not shrink when a layer is tiny or never moves.

## The idea

Flatten layers that are static over a shared window into one PNG, then overlay
that single image. Five overlays become one.

## Why this does not reduce flexibility

**The merge is a compile-time optimisation, not an authoring change.** The
composition keeps every element as its own object with its own animation,
timing and z-order. Nothing about how a clip is *written* changes.

A group is merged only when all of the following hold:

- identical `startAt` and `duration` (the same window on screen)
- **no animation** of any kind — opacity, x, y or scale
- no `blend` and no `mask` (both need their own subgraph)
- no `chromaKey`
- adjacent in z-order, so flattening cannot change what draws over what

Anything failing a condition stays its own layer. The rule is: **merge only
what provably cannot change within the window.**

## Payoff

- Fewer inputs, fewer full-frame composites per frame.
- Composes with 027: a merged group is one more thing the segment hash covers.
- Composes with the still-trim work (023): one long-lived still instead of five.

## Risks

- **Text is the main candidate, and text is where correctness is subtle.** Font
  fallback, subpixel positioning and line breaking must be identical when
  rasterised into a merged image versus drawn by `drawtext` per frame. If they
  differ, the clip changes appearance for a speed win — the `zoompan` mistake
  again. Parity must be checked by rendering both ways and comparing pixels.
- Merged groups are rasterised at compile time, so they must be rasterised at
  the **preview size** too when previewing (see 024), or a preview would
  flatten at full resolution.
- The merge adds a compile-time rasterisation step, so it must batch (one
  process for all groups), not spawn per group.

## Relationship to other tickets

- 023 — still lifetime.
- 024 — preview composites at preview size; merged groups must honour it.
- 027 — incremental render; merged groups are part of a segment's hash.
- 026 — GPU scale; fewer layers means fewer uploads if CUDA is ever enabled.
