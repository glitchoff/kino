# Changelog — session 2026-11-20

Everything this session changed, and what it was worth. Newest last.

Each entry says what shipped, the measured effect, and whether it is committed.

---

## 1. Stills stop decoding once off screen — **committed `613f948`**

Every image was `-loop 1 -i panel.jpg` for the whole timeline.
`enable='between()'` hid it but did not stop the work, so a panel on screen for
6 s in a 238 s composition paid for 238 s of decode.

`trim=end` now bounds each still to its own window, on the filter branch rather
than `-t` on the input — so a mis-sized window can only shorten one layer and
cannot starve a later scene.

**Not separately timed.** The filtergraph was verified; the win is structural
(a long-lived decode becomes a short one) rather than measured. Ticket 023.

---

## 2. `--preview` composites at preview size — **committed `a1acb7e`**

The old code appended `scale=-2:H` after every scene, transition and blend, so a
144p preview did full 1080p work and discarded it.

Backgrounds, media, text and blends are now built for the smaller frame.

**Measured:** 36 s, 6-scene, 1080p bench at 144p → **20.4 s** (from doing full
1080p work per frame).

Text scales with the frame (verified: `fontSize: 96` → `7` at 82×144).
Ticket 024.

---

## 3. `zoompan` for scale ramps — **committed `a1acb7e`**

A linear 1–10 scale ramp on an opaque full-frame image compiles to `zoompan`
instead of a per-frame `scale` resample.

**Measured:** 1359 ms vs 3336 ms for 180 frames at 1080p in isolation; the full
bench went **20.4 s → 10.9 s**.

Guarded by: opaque only (`zoompan` flattens alpha — verified), covers the frame
(output is fixed at `s=WxH`, so a small element would be cropped), linear
easing only (overshoot curves pass their endpoints), `from`/`to` within 1–10
(ffmpeg's documented range), no opacity animation. 12 tests.

**Parity:** matches `scale` + centred overlay to 1–2 px. Ticket 025.

---

## 4. Tests no longer depend on the host GPU — **uncommitted**

`resolveEncoderSync` probes the card, so a machine with a GPU got `h264_nvenc`
where tests asserted `libx264`. `vitest.config.ts` now pins `KINO_ENCODER=libx264`
and `resolveEncoderSync` honours it.

**Effect:** the nvenc failures are gone.

---

## 5. Preview tests rewritten for the new contract — **uncommitted**

Four tests asserted the old end-of-graph downscale and failed after change 2.
They now assert the frame is built small (`s=82x144`), that a full render is
full-size, that element and drawtext counts are unchanged, and that text scales.

**19/19 green.**

---

## 6. yt-dlp stub made cross-platform — **uncommitted, not yet green**

The test wrote a Unix shebang script and joined PATH with `:`. On Windows
`spawnSync` cannot execute that, and `.cmd` needs `shell: true`.

Two fixes: `ytdlp.ts` spawns with `shell: process.platform === "win32"` (a real
bug — a pip/venv `yt-dlp.cmd` could never run), and the test writes a `.cmd` and
uses `path.delimiter`.

**Status:** the binary is now found but the stub still fails. Not finished.

---

## 7. CUDA measured and rejected — **uncommitted, default off**

`scale_cuda` beat CPU `scale` 3× in isolation (3,613 ms vs 10,949 ms), so it was
wired in.

**Then the end-to-end measurement inverted it:** 44.5 s with CUDA vs 39.1 s
without, on a 36 s 1080p render. `zoompan` and `drawtext` have no CUDA variants,
so every element pays an upload and a download per frame.

`overlay_cuda` was also slower than CPU (12,312 ms vs 10,949 ms).

`scaleCuda` now ships **default off**, with the measurement recorded. Parity was
fine (1.5–3.7/255) — the loss was purely the round trip. Ticket 026.

**The lesson worth keeping:** a filter-level speedup is not a render-level one.

---

## 8. Scratch beside the output — **uncommitted**

All intermediates went to `os.tmpdir()` — on this machine `C:`, which had
**3.1 GB free**. Scratch is now `<output dir>/.kino/stage-xxxx`.

Verified: `...\kino-bench\.kino\stage-6qgRjl`.

`KINO_TMP` overrides. Ticket 029.

---

## 9. Scratch in RAM, opt-in — **uncommitted**

`render(comp, { ram: true })` uses `/dev/shm` on Linux, or `KINO_RAMDISK` on
Windows. Falls back to disk **with a warning** — never silently pretends.

Verified on this machine (no RAM disk): warns and falls back correctly.
Batching dropped by decision — the working set is small. Ticket 030.

---

## Recorded but not built

- **028** Merge static layers into one overlay per scene. Proposed; merges only
  provably-static groups, so authoring flexibility is unchanged.

---

## 10. Incremental render — `cache: true`

The feature the whole session was for: edit one scene, re-render only what
changed.

Each scene is rendered as its own segment and joined with `-f concat -c copy`.
Segments are keyed by a hash of the scene's content, so an unchanged segment is
reused from disk.

**Transitions are handled as "adjacent scene"**, which dissolves the blocker that
had parked this ticket. A fade draws from both scenes, so segment N renders
scenes N-1 and N *together* and keeps only the slice it owns. The fade is
physically in the encoded file before the cut — nothing needs to share tails
between separate files.

Segments own abutting slices `[start_i, start_{i+1})`, so the join reproduces
the timeline with no gap and no double-count.

**Measured** — synthetic 3-scene probe, 640×360, 2 s scenes, 0.4 s fades:

| Run | Reused | Rendered | Time |
| --- | --- | --- | --- |
| cold | 0 | 3 | 4719 ms |
| no edit | 3 | 0 | 704 ms |
| edit scene 2 | 1 | 2 | — |

Editing scene 2 invalidated scenes 2 and 3 (the fade between them) and reused
scene 1 — the intended two-segment blast radius.

Output verified by frame hash, not by eye: 156 frames (5.2 s = 2 + 1.6 + 1.6),
and the three slices hash differently, so the join is real rather than one scene
duplicated three times.

**Costs, stated plainly:** a one-shot render is *slower* with the cache (one
ffmpeg run per segment plus a concat pass). It pays off from the second render.
The cache never garbage-collects.

---

## 11. Caption rasteriser broke on every absolute Windows path

Not an optimisation — a bug that had been sitting in the "pre-existing failures"
bucket.

`captionImages()` failed every word with `Both text and text file provided`.
Nothing provided `text=`. The real cause: `:` separates filter options, so
`textfile='C:\…'` splits the argument and the parser reads the remainder as a
bare `text`.

Reproduced directly against ffmpeg 6.1.1. Forward slashes do **not** help
(`C:/…` still has the colon); escaping it does (`C\:/…`).

`text.ts` already escaped correctly via `escapeFFmpegStr()`. The caption
rasteriser hand-rolled all three of its paths and did not. That asymmetry is why
normal text worked and captions did not.

**Verified:** caption suite 32/40 → **40/40**. The 8th failure was a separate
test bug — it asserted a POSIX-separator path on Windows — fixed separately.

---

## Numbers

| | 36 s bench @ 144p |
| --- | --- |
| Before | full 1080p work per frame |
| Preview fix | 20.4 s |
| + `zoompan` | **10.9 s** |

All figures are a synthetic bench shaped like a real clip. No number exists for
a real composition.

---

## Honest state at session end

- **Captions are green** — 40/40, after the path-escape fix (change 11). Before
  the fix the file was 32/40; the 8 failures had been treated as pre-existing
  and were a real engine bug.
- Full suite after these changes: **5 failures across 2 files** — 1 export
  (`export.test.ts`: frames named from the timestamp), 4 ytdlp (the Unix-shebang
  stub cannot execute on Windows). Baseline before this session was 14
  (captions 8, export 2, ytdlp 4); the 8 caption failures are gone. The export
  count is 1, not the 2 the baseline recorded — that line was slightly off.
- **No new failures.** 28 test files passed, 2 skipped.
- Changes 4–11 are committed in `fdcc73f`; changes 1–3 in `613f948`, `a1acb7e`,
  `d799517`.
- Eight scratch call sites still use `tmpdir()` directly; only `compile.ts` was
  migrated.
