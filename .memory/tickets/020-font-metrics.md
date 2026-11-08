# 020 — Replace the rasterised text measurement with font parsing

**Status:** done (2026-11-08) — `src/measure/font.ts` parses `head`/`hhea`/`hmtx`/`cmap` (+ `kern` format 0). `measureText()` and `inspect()` are now synchronous. Verified against a render: centred "Title" at 64px predicts ink at 258.9, drawtext puts it at 258.
**Created:** 2026-11-08

## Problem

`measureText()` (shipped in `3a938ae`, ticket 012) rasterises each string with
ffmpeg and finds the ink extent. It works, and it is the wrong approach:

- **One ffmpeg process per string**, ~10–20 ms. `inspect()` on a 20-element
  composition spends a second shelling out to answer a question that is pure
  arithmetic.
- **Hard dependency.** The `measure: false` option exists precisely because the
  good path is not always available, and then `inspect` silently degrades to
  numbers that are up to 48 px wrong on `"WWWW"` at 64 px.
- **It measures the wrong quantity.** Rasterising gives *ink extent*; drawtext
  positions on *advance width*. That is the 8 px / 4 px left-edge discrepancy
  documented in the `inspect` verification, and the reason centred text does not
  line up exactly.
- **Silent failure modes.** Wrong font file, missing file, unusable ffmpeg —
  each falls back to the estimator with only a warning.

## Proposed

Read the advance widths out of the font file directly.

```ts
measureText("Maybe", { fontSize: 64 })  // synchronous, exact, no process
```

A TTF/OTF advance lookup needs four tables:

| Table | Gives |
| --- | --- |
| `head` | `unitsPerEm` |
| `hhea` | `numberOfHMetrics` |
| `hmtx` | advance width per glyph |
| `cmap` | character → glyph id (format 4 and 12 cover almost everything) |

Advance of a string = `sum(hmtx[cmap[ch]]) / unitsPerEm * fontSize`. That is the
number drawtext uses for `text_w`, so the discrepancy disappears rather than
being documented.

Inter is already bundled at `assets/Inter-Regular.ttf`, so there is no new
dependency and no download.

## Consequence for the API

`measureText` becomes **synchronous**. `inspect()` then becomes synchronous too,
and loses its `measure` option — there is no bad path left to opt out of. That is
a smaller, better API than what shipped, and worth a breaking change before
anyone depends on it.

## Open questions

- **Kerning?** `kern` (old) and `GPOS` (common) both adjust advances for pairs.
  Inter has `GPOS`. Without it, `"AV"` measures a little wide. Worth doing after
  the base case, and the difference is small enough to ignore at first.
- **CFF/OTF?** `.otf` fonts use `CFF ` outlines but still have `hmtx`, so the
  same code works. Only `unitsPerEm` handling differs and it does not.
- **Variable fonts?** `fvar`/`gvar` change advances per axis. Out of scope; use
  the default instance.
- **Do we keep a raster check?** A test comparing the parsed advance against a
  rendered frame would catch parser bugs. Keep the rasteriser *in the test*, not
  in the library.

## Related

- Supersedes the rasteriser in `src/measure/index.ts` (ticket 012).
- `inspect()` (ticket 011) becomes sync and exact.
- `captionImages` has its own copy of the rasteriser; ticket 014 removes that
  duplication, and this makes it unnecessary entirely.
