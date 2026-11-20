# Changelog — session 2026-11-21

Live preview, the frame cache, and a caption spacing fix. Newest last.

Each entry says what shipped, the measured effect, and whether it is committed.

---

## 1. `serve()` — a preview server in the package — **committed `d8ab559`**

```ts
import { composition, serve } from "@glitchoff/kino";
await serve(video);           // http://localhost:3333
```

Routes:

| path | what |
| --- | --- |
| `/` | the preview player |
| `/render` | the final render, separate path and page |
| `/api/proxy` | builds the seek proxy + warms the frame cache |
| `/api/proxy.mp4` | the proxy as a playable mp4, with range support |
| `/api/frame?raw=1&t=` | one frame as raw rgba |
| `/api/render` | produces the deliverable |

Deletes `studio/` (React + Vite + Monaco, untouched since August) and its
dependencies. Adds `kino preview <file>`.

**Trap hit twice:** `@glitchoff/kino` resolves to `dist/`, so an export added to
`src/` does not exist for a composition file until `pnpm build`. First `serve`
wasn't exported; then an edited page string kept serving the old text.

---

## 2. Realtime scrubbing via an in-memory frame cache — **committed `1f63dc1`**

**The finding that mattered:** one frame cost 623 ms, and it was almost entirely
process spawn. Measured on a 640×360 proxy:

| shape | cost |
| --- | --- |
| spawn per frame (the old `Preview.frame`) | **623 ms** |
| `ffmpeg -version` alone, no decode | **641 ms** |
| 30 frames in one process | 531 ms total (**17.7 ms/frame**) |
| decode the whole proxy once | **0.0004 ms/frame** |

A process spawn on this machine costs more than decoding 30 frames. Asking
ffmpeg again per frame *was* the entire expense.

So: decode the proxy once into raw rgba, serve frames from memory.

| | before | after |
| --- | --- | --- |
| per frame | 623 ms | **4.75 ms** |
| fps | 1.5 | **211** |

Measured over HTTP against the real 21.5 s Paper Ghost opening, 120 random
seeks: p50 3.62 ms, p95 11.28 ms. 646/646 frames resident in 568 MB.

A first attempt cached frames but still encoded each to JPEG — **662 ms, no
gain at all**, because the encode was another spawn. The win only arrived when
ffmpeg left the per-frame path entirely.

**Also:** `frameCacheMB` was declared on `ServeOptions` but never threaded
through, so setting it did nothing.

---

## 3. Panels render in the right place in preview — **committed `1f63dc1`**

An element with a scale animation emitted `scale=iw*<expr>` straight onto the
raw input, so the fit/downscale filter was never applied. `iw` is the *source*
size, so an 870 px panel went into a 640 px preview frame undownscaled and hung
off the right edge. Nearly every panel in a real composition is animated, so
this hit all of them.

The target size is now applied before the animated scale.

**Verified by pixel bounding box**, not by eye: 2 px worst edge error at
640×360 (`minX 172 / maxX 466 / minY 0 / maxY 293` against an expected
`172 / 467 / 0 / 295`).

Second half of the same bug: `previewScale` was applied to the scale filter but
not to the overlay position, so a panel was drawn at the right size in the wrong
place. One `previewMedia` value now feeds scale, position, animation and the
still-window trim.

---

## 4. Narrated compositions can preview at all — **committed `1f63dc1`**

`Preview.open` never resolved TTS, while `render()` did. A raw
`{ __kinoTts: true, text, options }` spec reached `compile()` and
`prestageRemoteAssets` called `.startsWith()` on it:

```
TypeError: src.startsWith is not a function
```

Every `voice()` composition failed to preview. `Preview.open` now resolves TTS
first, exactly as `render()` does, and `isRemote` tolerates a non-string `src`.

---

## 5. Caption spacing and baseline — **NOT COMMITTED**

Two separate bugs, both in `reveal`, which used to emit **one element per word**:

**Gaps.** Each word's x came from `estimateTextWidth`, a character-class table
that prices lowercase at 0.52em where the font draws closer to 0.25em:

| word | estimated | drawn |
| --- | --- | --- |
| `you` | 72 px | ~35 px |
| `have` | 96 px | ~48 px |
| space | 14 px | 27 px |

That estimate *is* the advance, so the error became a gap — and because each
word's error differed, the gaps were uneven too. In a rendered line: 15, 40 and
14 px between words, where one value was needed. A line read `Whathas`.

**Baseline.** `bottom-N` compiles to `h - text_h - N`, and `text_h` is *that
element's* height. With one element per word, a word with an ascender (`have`)
is taller than one without (`you`), so each word sat on its own baseline and the
words visibly stepped up and down. That is what read as "inconsistent font
size" — the size was never different.

**Fix:** a line is now **one element**, holding the full text at one position,
with per-word timings driving the highlight through the existing `captionWords`
machinery. One `text_h`, so the baseline cannot drift; the font lays out the
words itself, so there is no advance to estimate.

Verified in a rendered frame:

| | word gaps | baseline spread |
| --- | --- | --- |
| before | 15, 40, 14 | 9 px (words stepping) |
| after | **16, 18, 14, 19** | **0 px** |

Letter gaps stay 2–5 px. It is also faster: one drawtext per line instead of
two per word, and no measuring.

**A wrong turn worth recording.** The first fix kept one element per word and
measured real glyph widths with ffmpeg — batched into one call per line, ~700 ms
each. It produced correct gaps (24/35/69/30 px) and 40/40 tests passed, but it
took **411 s** to run the caption suite and it never fixed the baseline, because
per-word elements still each got their own `text_h`. Measuring was the wrong
direction: the font already knows its own glyph widths, so the answer was to let
it lay out the line. `src/captions/measure-batch.ts` was deleted.

**Status:** built and measured, not yet committed or run through the full suite.


---

## Honest state at session end

- Full suite at the last full run: **5 failures across 2 files** — 1 export
  (`frames are named from the timestamp`), 4 ytdlp (the Unix-shebang stub
  cannot execute on Windows). Same as the 2026-11-20 baseline; no new failures
  from changes 2–4.
- Change 5 is uncommitted and has not been through the suite.
- **The proxy build is still an export.** 16.3 s for the 21.5 s Paper Ghost
  opening, ~580 s for the 266 s full-chapter clip at 144p. Everything after the
  build is realtime; the build is the wait.
- The frame cache is **prefix-only**: it holds frames from t=0 until the budget
  runs out, and anything past that seeks the proxy (~17 ms). A sliding window
  was designed but not built.
- Eight scratch call sites still use `tmpdir()` directly, from the previous
  session.
