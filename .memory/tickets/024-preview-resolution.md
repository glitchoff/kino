# 024 — `--preview` composites at preview resolution

**Status:** in progress (2026-11-20) — source-level downscale implemented;
typecheck clean, `tsup` builds. Timing measurement pending.
**Created:** 2026-11-20
**Reported by:** paper-ghost clip renders.

## Problem

`--preview` appended `scale=-2:H` at the very end of the graph (Stage 3b), after
every scene, transition, blend and overlay. A 144p preview therefore did full
1080p work on every frame and threw the result away in the last filter.

From paper-ghost's `findings.md` (2026-11-20): `--preview 144 --dry-run` on a
3:58 composition showed no `scale=` before the encoder, and a render burned
2,135 CPU-seconds. Their guide says outright: "`--preview` is not a speed tool
until the downscale moves before the encoder."

That makes preview useless for the one job it exists for — iterating on layout.

## Change

Compute the preview frame up front, before the scene loop:

```ts
const previewHeight = resolvePreviewHeight(options?.preview);
const pw = previewHeight !== undefined
  ? Math.max(2, Math.round((width * previewHeight) / height / 2) * 2)
  : width;
const ph = previewHeight !== undefined ? previewHeight : height;
```

Then composite every scene on `pw × ph`:

- **Backgrounds** — built at `pw × ph` (`buildSceneBackground`).
- **Media** — `previewScale()` re-expresses `width`/`height`/`x`/`y` by the same
  ratio. Scaling the numbers rather than inserting a `scale=` filter keeps
  `overlay`'s `main_w - overlay_w` centring correct.
- **Text** — font size and position scale by the same ratio, and the transparent
  canvas is `pw × ph`. Otherwise text is full size on a tiny frame and runs off.
- **Blend/mask** — receives `pw`/`ph`.

The output-stage downscale is **deleted**; the finished pad is already the
preview size.

`previewScale()` returns `{}` at ratio 1, so a full render's filtergraph is
byte-identical to before this change.

## Why the scene graph is still honest

Same elements, same order, same timings, same grade. Only the pixel grid the
composition runs on differs. A preview is the full render at lower resolution,
not a different pipeline — which is what the old end-of-graph downscale also
claimed, but at the cost of doing all the work first.

## Trade-off

Previews are no longer pixel-exact against a full render at fine detail: a
1.5px stroke or a sub-pixel text offset can round differently on a small grid.
That is inherent to previewing at a lower resolution and is what previews are
for. The layout, timing and motion are what it verifies.

## Still to do

- [ ] Time `--preview 144` before/after on the paper-ghost clip and record it.
- [ ] Confirm a preview frame still shows content (sample from the middle, not
      the opening shot — see their black-frame finding).
- [ ] Full `pnpm test` (baseline already red: 15 failures / 5 files).
