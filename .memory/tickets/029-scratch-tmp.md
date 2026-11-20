# 029 — Put scratch files on fast storage (`KINO_TMP`)

**Status:** implemented (2026-11-20) — `src/pipeline/scratch.ts`. Call sites not
yet migrated.
**Created:** 2026-11-20
**Requested as:** "Put temp PNGs and segments on a RAM disk or /dev/shm (Linux)
so rasterized overlays aren't hitting the SSD."

## Problem

Every intermediate file goes to `os.tmpdir()`: staging dirs, extracted
artifacts, caption PNGs (one per word), Takumi output, preview frames. On this
machine that is `C:\Users\Abhay\AppData\Local\Temp`, and **`C:` has 3.1 GB
free** — a long captioned render could plausibly fill it.

## What exists

- **Linux:** `/dev/shm` is a real RAM disk. `KINO_TMP=/dev/shm/kino` is the
  fastest option when the render fits in memory.
- **Windows:** no built-in equivalent. A RAM disk needs a driver (ImDisk,
  OSFMount) mounted first, then `KINO_TMP` points at its drive letter.
- **This machine now:** `D:` has 61 GB free. Pointing `KINO_TMP` there is a
  real win with no install.

## Implementation

`scratchRoot()` in `src/pipeline/scratch.ts` honours `KINO_TMP`, creates the
directory on first use, and falls back to `os.tmpdir()` if the override is
unwritable — a bad path should not fail a render.

`scratchDir(prefix)` wraps `mkdtempSync` under that root.

## Still to do

Eight call sites still use `tmpdir()` directly:

```
compile.ts:199        export.ts:223,257     preview.ts:58
render.ts:89,100,126  takumi-elements.ts:31
```

Each becomes `scratchDir("kino-…")`. Low risk, but it touches the render path,
so it wants the full suite green first.

## Note

Scratch is deleted per render, so a RAM disk never accumulates. The segment
cache (027) is the opposite — it must persist, so it belongs on disk and should
*not* follow `KINO_TMP` to `/dev/shm`.
