# 023 — Bound a still's decode to its on-screen window

**Status:** in progress (2026-11-20) — `trim=end` added to the still branch in
`src/pipeline/compile.ts`; typecheck clean; filtergraph verified; suite pending.
**Created:** 2026-11-20
**Consumed by:** paper-ghost (clip renders) — see their `shared-work.md` claim.

## Problem

Every `image` element becomes `-loop 1 -i asset.jpg` opened at the top of the
timeline. `enable='between(t,…)'` in the overlay hides it when it is off screen,
but ffmpeg still runs the whole branch — scale, fps, format, overlay — on every
frame of the composition.

Reported from a real clip (paper-ghost, `findings.md` 2026-11-20): a 3:58
composition with 75 panels burned **2,135 CPU-seconds**. A panel on screen for 6 s
paid for 238 s of decode. Single-input cost measured at 27 ms/frame; with 75
inputs alive it multiplies.

The panel side already pre-scales images (`compose.py:prescale()`), so the
remaining cost is purely the unbounded lifetime.

## Change

On the still branch (`compile.ts`, the `else` of the video/`isVideo` check):

```
[1:v]scale=100:100,fps=30,trim=end=5.000,setpts=PTS-STARTPTS,settb=AVTB[img_base_1]
```

`stillWindow()` returns `min(sceneDur, startAt + duration)`, fixed to 3 decimals
(the graph is already the thing that overflows Windows' command line). It returns
`undefined` — no trim — when the window cannot be bounded.

**Trim on the filter, not `-t` on the input.** Inputs stay byte-identical, so a
mis-sized window can only shorten one layer; it can never starve a later scene.
That is the exact failure mode paper-ghost hit on 2026-11-20: a raw-decode
optimisation whose files were never packed into the `.kino`, giving panels in
beat 1 and pure black from t=15s. Keeping the input untouched removes that class
of bug.

`setpts` rebases the trimmed output to t=0 so the overlay still sees the still on
the scene clock; `enable=between()` remains the authority on visibility.

## Verified

- `npx tsc --noEmit` — clean.
- `startAt: 2, duration: 3` in a 10 s scene →
  `trim=end=5.000` + `enable='between(t,2,5)'` — window matches exactly.
- No explicit `duration` → normalization fills scene length →
  `trim=end=10.000`, i.e. still bounded, matching the scene end. Harmless and
  stricter than expected: the "no trim" path rarely fires.

## Still to do

- [ ] Full `pnpm test` (baseline is already red: 15 failures / 5 files before
      this change — 8 captions, 4 ytdlp, 2 nvenc per paper-ghost's guide).
- [ ] Frame-sample a real render across the whole timeline, **from the middle**,
      not the opening shot — paper-ghost's rule after the black-frame incident.
- [ ] Measure the CPU-second delta on the 3:58 clip and record it here.

## Not the same as

- **Pre-scaling panels** — that is the consumer's job, already done in
  `compose.py`.
- **`--preview`** — the downscale still appends after the whole scene graph
  (`compile.ts`, Stage 3b), so 144p does full 1080p work. Separate ticket if we
  want preview to be a speed tool.
