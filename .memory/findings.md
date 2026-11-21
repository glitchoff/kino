# Findings — durable technical discoveries

Hard-won facts about this stack that are **not obvious from the code** and that we
don't want to rediscover the hard way. Each entry is a fact + the evidence that
proved it + what it means for future work.

Newest on top. One fact per entry. Keep the evidence — a finding without a
reproduction is a rumour.

Tickets hold the *work*; this file holds the *facts* the work established. When a
ticket teaches something that will outlive it, it belongs here.

---

## 2026-11-21 — On Windows, `.EXE` beats `.CMD` on PATH regardless of order

**Claim:** putting a stub directory first on `PATH` does **not** make a `.cmd`
stub win over an installed `.exe` of the same name. Windows resolves a bare name
through PATHEXT (`.COM;.EXE;.BAT;.CMD;…`), and the extension order decides — not
the directory order.

**Evidence:** `test/ytdlp.test.ts` put a stub dir first on PATH and still ran the
real `C:\Users\Abhay\.bun\bin\yt-dlp.exe`:

```
where yt-dlp -> C:\Users\Abhay\.bun\bin\yt-dlp.exe
                ...\Scripts\yt-dlp.exe
```

with `PATH has tmp: false` — the stub dir was not even reached. Before a real
yt-dlp existed the same test failed with `ENOENT`; installing one changed the
failure to a live network call to `example.com`, which is how it was caught.

**What it means:** never rely on PATH precedence to shadow a Windows binary.
Give the code an explicit override (`KINO_YTDLP` in `src/remote/ytdlp.ts`) and
have the test point at the stub directly. Also: a `#!/usr/bin/env node` script
with no extension cannot run on Windows at all, `chmod 0o755` is a no-op there,
and `spawnSync` needs `shell: true` before it can launch a `.cmd`.

---

## 2026-11-21 — A stateful frame server was the wrong shape; the stateless probe was right

**Claim:** compositing frames on demand through a long-lived ffmpeg looked like
the fix for the multi-minute proxy build, but it was never made to serve a frame
reliably over HTTP. The stateless shape — spawn, read N frames, exit — worked on
the first try and is what the class now does.

**Evidence:** the pruned video-only graph (1,838/2,057 chains) produced **120
correct frames, exit 0**, at ~67 ms/frame, first frame 10.5–14.5 s, on the
70-scene chapter at 144p. The same graph behind a stateful `LiveRenderer` failed
four times in sequence: a listener leak (`MaxListenersExceededWarning: 11 data
listeners on Socket`, then ECONNRESET), then consumed frames never re-served
(`ended at frame 5351 before 300`), then a skip loop that pruned the frame it
was waiting for, then every request returning 500.

**What it means:** the proxy path stays the recommended preview (0.5–5 ms/frame
after one build, verified end to end this session). The build wait is the real
problem, and the answer is a **segment cache**, not another live renderer. Full
post-mortem in `.memory/findings-live-render.md`.

---

## 2026-11-20 — An absolute Windows path in a `drawtext` option breaks the filtergraph

**Claim:** `drawtext=textfile='C:\Users\…\w.txt'` fails with
`Both text and text file provided`, because `:` separates filter options. The
parser splits `textfile` from its value, and the leftover is read as a bare
`text` argument.

**Evidence:** reproduced directly against ffmpeg 6.1.1:

```
drawtext=textfile='C:\…\w.txt':fontfile='D:\…\Inter-Regular.ttf':…
→ [Parsed_drawtext_0] Both text and text file provided. Please provide only one
```

Forward slashes alone do **not** help — `C:/…` still has the colon. Escaping it
does: `C\:/Users/…` renders (exit 0, PNG written).

**Implication:** every path reaching a `drawtext` option must go through
`escapeFFmpegStr()` (`src/pipeline/position.ts`), which escapes `\`, `'` and `:`.
`text.ts` already did; `captions/index.ts` hand-rolled its `fontfile` and
`textfile` arguments and was broken on Windows for any absolute font path. Fixed
in `captionImages` for all three sites.

**Cross-refs:** `tickets/031`.

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

## 2026-11-21 — A frame cost was process spawn, not render cost

**Claim:** kino's per-frame cost was almost entirely Windows process startup, not
decoding or compositing.

**Evidence,** 640×360 proxy, best of several:

| shape | cost |
| --- | --- |
| spawn per frame (old `Preview.frame`) | 623 ms |
| `ffmpeg -version` alone, no decode | **641 ms** |
| 30 frames in one process | 531 ms total (17.7 ms/frame) |
| decode the whole proxy once | 0.0004 ms/frame |

`ffmpeg -version` does no work and costs the same as a full frame. A spawn on
this machine is ~640 ms — more than decoding 30 frames.

**Implication:** never put a process on a per-frame path. The fix is to decode
the proxy once into RAM and serve frames from memory: 4.75 ms/frame over HTTP,
211 fps, on a real 21.5 s composition.

**Trap hit once:** caching frames but still encoding each to JPEG measured
**662 ms — no gain at all**, because the encode was another spawn. The win only
arrives when ffmpeg leaves the per-frame path completely.

**Cross-refs:** `src/pipeline/frame-cache.ts`, `docs/studio.md`.

---

## 2026-11-21 — Preview must resolve TTS before compile, or every voice() clip fails

`compile()` is synchronous and `prestageRemoteAssets` expects every `src` to be
a path string. `render()` resolves TTS first; `Preview.open` did not, so a raw
`{ __kinoTts: true, text, options }` spec reached it and:

```
TypeError: src.startsWith is not a function
```

Any composition using `voice()` therefore failed to preview. Fixed by resolving
TTS in `Preview.open` exactly as `render()` does, plus a guard in `isRemote` so a
non-string cannot take down the whole compile.

**Rule:** anything that calls `compile()` on a user composition must run
`resolveTtsTracks()` first when `compositionHasTts()` is true.

**Cross-refs:** `src/pipeline/preview.ts`, `src/tts/resolve.ts`.

---

## 2026-11-21 — An animated element skipped its fit filter entirely

An element with a `scale` animation emitted
`scale=w='max(2,iw*<expr>)':h='max(2,ih*<expr>)'` straight onto the raw input,
**replacing** the fit/downscale filter. `iw`/`ih` are the *source* size, so:

- in a preview, a 870 px panel went into a 640 px frame undownscaled and hung off
  the right edge — every animated panel, because nearly every panel is animated;
- the target `width`/`height` were computed and then thrown away.

Fixed by applying the fit first, then the animated scale. Verified by pixel
bounding box, not by eye: 2 px worst edge error at 640×360.

**Second half of the same bug:** `previewScale` was applied to the scale filter
but not to the overlay position, so a panel was drawn at the right size in the
wrong place. One `previewMedia` value now feeds scale, position, animation and
the still-window trim, so they cannot disagree about coordinate space.

**Cross-refs:** `src/pipeline/compile.ts`, `src/pipeline/elements/media.ts`.

---

## 2026-11-21 — `reveal` captions: estimate for layout, and per-word `text_h`

Two bugs, one cause: `reveal` emitted **one element per word**.

**Gaps.** Each word's x came from `estimateTextWidth`, whose lowercase price is
0.52em where the font draws closer to 0.25em. That estimate is the advance, so
the error became a gap, and because each word's error differed the gaps were
uneven — 15, 40 and 14 px in one line. A line read `Whathas`.

**Baseline.** `bottom-N` compiles to `h - text_h - N`, and `text_h` is *that
element's* height. Per-word elements each got their own baseline, so a word with
an ascender (`have`) sat higher than one without (`you`). That reads as
inconsistent font size; the size was never different.

**Fix:** one element per line, full text, with `captionWords` driving the
highlight. One `text_h`, and the font does the layout. Word gaps 16/18/14/19 px,
baseline spread 0 px.

**Wrong turn worth recording:** the first fix kept per-word elements and measured
real glyph widths with ffmpeg (batched, ~700 ms per line). Gaps became correct
but the baseline stayed broken — per-word elements still each got their own
`text_h` — and the caption suite went from seconds to **411 s**. When a font is
doing the drawing, let it do the measuring.

**Cross-refs:** `src/captions/index.ts`, `src/pipeline/elements/text.ts`.

---

## 2026-11-20 — A true live preview is not possible with a filtergraph batch renderer

**Claim:** kino cannot preview like a video editor (play instantly, no encode)
because one composited frame on demand costs **654 ms**, and an editor needs
24–30 fps.

**Evidence:** 640×360, one scene, text only. Compile the composition, extract
the artifact, run the compiled filtergraph with `-frames:v 1 -f rawvideo`, and
time it:

```
compile:  1654 ms   (once)
one frame: 654 ms   (cold — spawn + graph build + decode + composite)
```

**How an editor differs.** Premiere or Resolve keeps a process alive, keeps
decoded sources cached, and composites only the frame under the playhead. That
is the same work as an export minus the encode and minus the file write, which
is why it is instant. kino compiles the whole timeline into one ffmpeg
filtergraph: asking for one frame means spawning ffmpeg, building the graph,
decoding from the start of the relevant inputs, compositing, and exiting.

**Implication:** a proxy is the only shape that gives smooth playback, because
by the time you watch it, it *is* a video file. `serve()` does that: the proxy is
an all-keyframe mp4, so `<video>` plays it at full speed and seeks instantly.
The "instant" part is the seek, not the build. Calling the proxy build "live
preview" is wrong — it is an export at proxy size.

A real live preview would need a persistent renderer that keeps state between
frames. That is a different engine, not a feature.

**Cross-refs:** `tickets/021`, `src/pipeline/serve.ts`.

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

### Correction (same day) — the mechanism was wrong, the conclusion was right

The table above changed **two** variables per row, so it never measured
`overlay_cuda` on its own. Re-measured with one variable per row, decoded inputs,
best of 3, every chain gated on actually emitting 300 frames:

| Chain | 1080p | 720p | 360p |
| --- | --- | --- | --- |
| CPU scale + CPU overlay | 1,528 ms | 1,434 ms | 1,436 ms |
| CPU scale + **overlay_cuda** | 2,196 ms | 1,881 ms | 1,830 ms |
| *upload+download only, no filter* | *1,712 ms* | *1,482 ms* | *1,452 ms* |

`overlay_cuda` loses at every size, so the conclusion stands. But **the cost is
not bandwidth.** The bare round trip costs ~1,450 ms even at 640×360 — one ninth
the pixels of 1080p — so it is **fixed per-frame overhead** (allocation,
synchronisation, context switching), not data volume. Resolution cannot rescue
it.

GPU use was verified, not assumed: `nvidia-smi` showed utilisation 0% → ~50% and
VRAM 689 → 872 MiB during a CUDA chain. The filters do run on the card; they
spend their time on bookkeeping.

Two traps this exposed, both worth remembering:

- **A crashed ffmpeg looks like a fast ffmpeg.** Three of my benchmark rounds
  timed processes that had failed with `Filter format:default has an unconnected
  output`. Gate every chain on emitting the expected frame count before timing
  it.
- **My absolute numbers do not match the ones above** (1,528 ms vs 10,949 ms for
  the same shape). Something in the original setup differed and could not be
  reconstructed. Treat the original absolute figures as unreproduced; only the
  relative ordering survived.

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
