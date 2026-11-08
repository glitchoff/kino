# 014 — One caption pipeline, two renderers

**Status:** open
**Created:** 2026-11-08

## Problem

`captionImages` duplicates the caption pipeline rather than sharing it.

It calls `buildCaptionLines(groupWords(...))` again, re-derives the
`color`/`highlight`/`at`/`zIndex` defaults, and re-implements line centring. It
does not use `baseOptions`, `measure` or `resolveAnchor`, which the text path
does.

That duplication has already caused one bug. `buildCaptionLines` trims each
line's hold so it cannot run into the next line, and that only works when it can
see the following line. The lyric example called `captionElements` once per
line, so the holds were never trimmed and two captions stacked on screen. The
same shape of mistake is available in `captionImages` any time someone calls it
per line — which is exactly what `examples/lyrics.ts` did before `4b38287`.

## Proposed

One internal seam. `captionElements` takes a renderer:

```ts
type CaptionRenderer = (lines: CaptionLine[], opts: ResolvedOptions) => Element[];
```

`text` and `image` become two renderers over the same `CaptionLine[]`.
Grouping, hold trimming, default resolution and anchoring happen once.

```ts
captionElements(timings, { render: "text" | "image" | "auto" })
```

## Ordering

1. **The seam** — no public change. Tests prove the text path produces
   identical output before and after.
2. **Move `captionImages` onto it** — its rasterising becomes a renderer.
3. **Public API** — `render: "auto"` picks based on line count, so callers stop
   having to know that `karaoke` stalls past six lines. That is the footgun.

Doing 3 first would mean naming options that are about to move.

## Open questions

- **Does `captions()` go async?** It is synchronous today. If `auto` can pick
  the image path, it must be async. That is a breaking change — either take it
  in a major, or add `captionsAuto()` and leave `captions()` sync.
- **Where does 2× rasterising live?** `captionImages` takes `width`/`height` and
  `displayWidth`/`displayHeight`, and the caller must keep them in sync. That is
  a rendering concern; a single `resolution: 2` would say the same thing.
- **Do the presets from the earlier proposal belong here?** `preset:
  "lyric-video"` as a named `Partial<CaptionOptions>` was discussed and dropped.
  It fits naturally once the seam exists, but is separate work.

## Related

- `groupWords` gained `{ gap, breakOn }` in `4b38287`, which removed the
  example's hand-rolled grouping.
- Ticket 009 (docs rewrite) should describe the final shape, not the current
  three-function one.
