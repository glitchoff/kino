# 031 — Caption rasteriser breaks on absolute Windows paths

**Status:** fixed and verified (2026-11-20). Caption suite 40/40.
**Created:** 2026-11-20
**Found by:** the 8 caption test failures that had been treated as pre-existing.

## Problem

`captionImages()` failed on every word with:

```
Failed to rasterise caption word 0: [Parsed_drawtext_0]
Both text and text file provided. Please provide only one
```

The message is misleading — nothing provided `text=`. The real cause is that a
`:` separates filter options, so an absolute Windows path inside
`textfile='C:\…'` splits the argument, and the parser reads the remainder as a
bare `text` option.

## Evidence

Reproduced directly against ffmpeg 6.1.1:

| Filter | Result |
| --- | --- |
| `textfile='C:\…\w.txt'` | `Both text and text file provided` |
| `textfile='C:/…/w.txt'` | same — the colon is still there |
| `textfile='C\:/…/w.txt'` | **works**, PNG written |

So forward slashes do not help; the colon has to be escaped.

## Fix

Three sites in `src/captions/index.ts` built paths by hand:

- `font` — `:fontfile='${options.fontFile}'`
- the probe — `drawtext=textfile='${probe}'…`
- per-word strips — `drawtext=textfile='${txt}'…`

All three now go through `escapeFFmpegStr()` from `src/pipeline/position.ts`,
which escapes `\`, `'` and `:` — the same helper `text.ts` was already using
correctly. That asymmetry is why captions broke while normal text did not.

## Lesson

The correct helper existed and was already used in the main text path. The bug
was three call sites that re-implemented it badly. When a fix is "escape the
path", check whether the codebase already has that function before writing it
again.

## Verification

Caption suite went from 32/40 to **40/40**. The 7 `Both text and text file
provided` failures all cleared with the escape fix.

The 8th failure was unrelated: `test/captions.test.ts:218` asserted the aligner
path contains the literal string `.cache/kino/captions`, which is a POSIX
separator. On Windows the real path is `C:\Users\…\.cache\kino\captions`, so the
assertion was wrong, not the code. Normalised to forward slashes before the
check.
