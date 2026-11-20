# Findings — durable technical discoveries

Hard-won facts about this stack that are **not obvious from the code** and that we
don't want to rediscover the hard way. Each entry is a fact + the evidence that
proved it + what it means for future work.

Newest on top. One fact per entry. Keep the evidence — a finding without a
reproduction is a rumour.

Tickets hold the *work*; this file holds the *facts* the work established. When a
ticket teaches something that will outlive it, it belongs here.

---

## 2026-11-20 — `C:` has 3.1 GB free, and that is where every scratch file goes

**Claim:** all kino intermediates land in `os.tmpdir()`, which on this machine is
`C:\Users\Abhay\AppData\Local\Temp` — and `C:` had **3.1 GB free** at the time of
writing. A long captioned render writes one PNG per caption word plus a staging
copy of every panel.

**Evidence:**

```
C:  OS         236.4 GB total,  3.1 GB free
D:  New Volume 237.7 GB total, 61.2 GB free
```

Scratch paths found in the source: `compile.ts:199`, `export.ts:223,257`,
`preview.ts:58`, `render.ts:89,100,126`, `takumi-elements.ts:31` — every one uses
`tmpdir()` directly.

**Implication:** scratch now lives in `<output dir>/.kino/`, next to the render
(see `tickets/029`). Same filesystem as the output, so nothing crosses a disk
boundary, and it is visible and deletable without hunting through
`%LOCALAPPDATA%`. `KINO_TMP` overrides it — `/dev/shm` on Linux, a RAM-disk
drive letter on Windows. The segment cache (027) must **not** follow it to a RAM
disk, since that cache is meant to persist between runs.

**Cross-refs:** `tickets/029`, `tickets/030`.

---

## 2026-11-20 — CUDA wins in isolation and loses in the pipeline

**Claim:** `scale_cuda` is ~3× faster than CPU `scale` when measured alone, but
**slower end to end**. Do not ship a filter-level speedup on the filter-level
number.

**Evidence:**

Isolated, 300 frames at 1080p, `-f null`:

| Chain | Time |
| --- | --- |
| CPU `scale` + CPU `overlay` | 10,949 ms |
| `scale_cuda` + CPU `overlay` | 3,613 ms |
| `scale_cuda` + `overlay_cuda` | 12,312 ms |

End to end, 36 s composition at 1080p, real encode:

| Build | Time |
| --- | --- |
| CPU scale | **39.1 s** |
| `scale_cuda` auto | 44.5 s |

**Why:** `zoompan` and `drawtext` have no CUDA variants, so every element pays
an upload *and* a download per frame. That round trip costs more than the resize
it saves. The isolated benchmark had no CPU-only filter in the chain; a real
composition always does.

**Implication:** `scaleCuda` ships **default off**. A filter-level win is not a
render-level win, and the gap here was large enough to invert the sign. Parity
was fine (1.5–3.7/255) — the problem was purely the round trip.

**Cross-refs:** `tickets/026`.

---

## 2026-11-20 — `overlay_cuda` is slower than CPU overlay

**Claim:** `overlay_cuda` loses to CPU `overlay` on a 4 GB laptop card, and the
winning shape is GPU-resample then CPU-composite, not all-GPU.

**Evidence:** 300 frames, 1920×1080, two inputs, `-f null` (no encode), RTX 3050
4 GB, ffmpeg 6.1.1 gyan.dev:

| Chain | Time |
| --- | --- |
| CPU `scale` + CPU `overlay` | 10,949 ms |
| `scale_cuda` + CPU `overlay` | **3,613 ms** |
| `scale_cuda` + `overlay_cuda` | 12,312 ms |

**Why:** `overlay_cuda` needs two uploads plus a download per frame. On a 4 GB
card that round trip costs more than the composite it saves.

**Implication:** do not reach for "all GPU" as an optimisation. Upload for the
resample, download, and composite on the CPU. Also note `drawtext`, `zoompan` and
`geq` have **no CUDA variants** — any of them in a chain forces a download
anyway, so a whole-scene GPU graph is never achievable for a typical composition.

**Cross-refs:** `tickets/026`.

---

## 2026-11-20 — `zoompan` flattens alpha and only zooms 1–10

**Claim:** `zoompan` cannot stand in for `scale=…:eval=frame` in general. It
returns an opaque frame regardless of input format, its output size is fixed at
`s=WxH`, and its `z` option is documented as **range 1–10**.

**Evidence:**

- Alpha: an RGBA source (red/blue halves) rendered through
  `format=rgba,zoompan=z=1:d=1:s=64x64` came back every pixel `0,0,255,255`.
  Adding `format=rgba` *before* the filter does not help.
- Range: `ffmpeg-filters.html` §zoompan — "Set the zoom expression. Range is
  1-10." So `popIn` (starts at 0.8) and any shrink-out are out of range.
- Size: `s` is the output size, so a 640×360 element on a 1920×1080 frame would
  be **cropped**, not scaled.

**Implication:** only opaque, full-frame elements with a linear ramp inside 1–10
and no opacity animation may use it. Everything else keeps `scale`. Each of these
guards prevents a silently wrong picture rather than a slow one — never clamp to
make one fit.

**Cross-refs:** `tickets/025`.

---

## 2026-11-20 — `zoompan` matches `scale` only when both are anchored the same

**Claim:** the two paths zoom about different origins unless you match the
anchor, and a mismatched comparison looks like the motion is *inverted*.

**Evidence:** a bright dot tracked across a 6 s ramp.

With `scale` (top-left anchor) vs `zoompan` centred, the dot moved +5 px one way
and −7 px the other — apparently opposite directions. With `scale` **plus a
centred overlay** vs `zoompan` centred, they agreed to 0–2 px at every timestep.

**Why:** a point at distance `d` from centre lands at `d·z` under `scale` with a
centred overlay, and at `d/z` under a `zoompan` that crops inward about the
centre. They coincide only when the origins match.

**Implication:** when comparing two render paths, make sure both are anchored the
same way before concluding they differ. This cost two wrong conclusions — the
first said "opposite direction", the second said "cannot work".

**Cross-refs:** `tickets/025`.

---

## 2026-11-20 — `--preview` must composite small, not downscale at the end

**Claim:** appending `scale=-2:H` after the whole graph does full-resolution work
and throws it away, so a 144p preview costs as much as a 1080p render.

**Evidence:** a 3:58 composition with 75 panels showed no `scale=` before the
encoder in `--preview 144 --dry-run`, and a render burned 2,135 CPU-seconds.
After moving the downscale to element entry, a 36 s 6-scene bench at 144p took
20.4 s.

**Implication:** a preview has to change the frame the composition runs on, not
just the frame it writes. The scene graph stays identical — same elements, same
timing — only the pixel grid differs.

**Cross-refs:** `tickets/024`.

---

## 2026-11-20 — A still keeps decoding until it is trimmed

**Claim:** `-loop 1 -i panel.jpg` runs for the whole timeline. `enable='between()'`
in the overlay hides the result but does not stop the work.

**Evidence:** a panel on screen for 6 s in a 238 s composition paid for 238 s of
decode; single-input cost measured at 27 ms/frame, multiplied by 75 live inputs.

**Implication:** bound each still with `trim=end` on its own branch. Keep the trim
on the filter, not `-t` on the input: inputs stay byte-identical, so a mis-sized
window can only shorten one layer and cannot starve a later scene.

**Cross-refs:** `tickets/023`.

---

## 2026-11-20 — Tests must not depend on the host GPU

**Claim:** any test that compiles a composition without pinning `encoder` gets a
different filtergraph on a machine with a GPU.

**Evidence:** `resolveEncoderSync` falls through to `detectBestEncoderSync`, which
probes the card. On an RTX 3050 it returns `h264_nvenc`; the tests asserted on
`libx264` flags and failed with `-c:v h264_nvenc -preset p2 -rc:v vbr -cq 20`.

**Implication:** `vitest.config.ts` sets `KINO_ENCODER=libx264` for the whole
suite, and `resolveEncoderSync` honours it. Tests that care pass `encoder`
explicitly. A filtergraph assertion that passes locally and fails on CI (or the
reverse) is almost always this.
