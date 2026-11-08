# 012 — Expose real text measurement

**Status:** open
**Created:** 2026-11-08

## Problem

Two different width functions exist, and only one of them is right.

- `estimateTextWidth` (in `src/normalize/element.ts`) is a per-character
  approximation. It under-measures by a few pixels per word — measured earlier
  in this repo: "Maybe" estimated 126.7 px at fontsize 64, rendered 133.
- `captionImages` measures for real: it rasterises the text with ffmpeg and
  finds the rightmost lit pixel, falling back to the estimator if ffmpeg is
  unavailable.

The accurate one is private to `src/captions/index.ts`. Everything else — the
renderer's line wrapping, `revealElements` positioning, any agent laying out
text — uses the approximate one. The comment in `revealElements` even notes that
measuring `"word "` counts a trailing space drawtext never draws, so it measures
`" "` separately to avoid drift.

## Proposed

Promote the rasterised measurement to a public function:

```ts
const width = await measureText("Maybe", { fontSize: 64, fontFile });
// exact rendered advance in pixels
```

And keep `estimateTextWidth` as the synchronous, no-ffmpeg fallback, documented
as approximate.

## Cost

Each measurement is an ffmpeg invocation (~10–20 ms). That is fine for layout
code measuring a handful of strings, and too slow for wrapping a whole
paragraph. Options:

- **Cache** by `(text, fontSize, fontFile)` — the same word recurs constantly in
  captions and headings
- **Batch** — measure many strings in one ffmpeg call, as `captionImages`
  already does per line
- **Keep the estimator for wrapping**, use exact measurement only where drift
  matters

The third is probably right for now: wrapping tolerates a few pixels, per-word
positioning does not.

## Open questions

- **Does `measureText` need the font file?** Different fonts have different
  advances. Passing `fontFile` should default to the bundled Inter, matching
  what the renderer does.
- **Should `inspect` (ticket 011) use this or the estimator?** Overflow checks
  want exact. But an async, ffmpeg-backed `inspect` is a heavier dependency than
  a pure-JS one — worth deciding before 011 lands.

## Related

- Ticket 011 depends on this for its text-overflow check.
- The estimator's inaccuracy is recorded in `done.md` under the 2026-11-07
  `reveal` entry.
