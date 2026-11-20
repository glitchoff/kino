# 026 — GPU: `scale_cuda` wins, `overlay_cuda` loses

**Status:** measured (2026-11-20). `scale_cuda` not yet wired in.
**Created:** 2026-11-20
**Hardware:** RTX 3050 4 GB Laptop, ffmpeg 6.1.1 gyan.dev build.

## What the card supports

`ffmpeg -hwaccels` → `cuda dxva2 qsv d3d11va`.
`ffmpeg -filters` → `scale_cuda`, `overlay_cuda`, `hwupload_cuda`,
`chromakey_cuda`, `colorspace_cuda`, `yadif_cuda`, `bwdif_cuda`,
`thumbnail_cuda`, `bilateral_cuda`.

Present is not the same as useful. Measured below.

## Measured

300 frames at 1920×1080, two inputs, output to `-f null` (no encode):

| Chain | Time |
| --- | --- |
| CPU `scale` + CPU `overlay` | 10,949 ms |
| **CUDA `scale` + CPU `overlay`** | **3,613 ms** |
| CUDA `scale` + CUDA `overlay` | 12,312 ms |

**`scale_cuda` is ~3× faster. `overlay_cuda` is slower than doing it on the CPU.**

`overlay_cuda` costs two uploads plus a download per frame; on a 4 GB laptop card
that round trip costs more than the composite saves. So the conclusion is
counter-intuitive and worth keeping: **upload for scaling, download, and overlay
on the CPU.**

## What cannot move to the GPU

- `drawtext` — no CUDA variant. Most kino compositions have text.
- `zoompan` — no CUDA variant (and it is already the fast path, ticket 025).
- `geq` — no CUDA variant; it backs opacity animation.

Any of these in a chain forces a download. So the GPU win applies only to the
resample step between them.

## Planned shape

Per element:

```
[in] hwupload_cuda, scale_cuda=W:H, hwdownload, format=…  → CPU overlay
```

Not one upload for the whole scene: the first CPU-only filter (text, zoompan,
geq) would force a download anyway, and holding every panel on the card at once
is exactly what a 4 GB card cannot do.

## Still to do

- [ ] Wire `scale_cuda` behind an option (and auto-detect when the binary has it).
- [ ] Confirm parity: `scale_cuda` uses a different resampler than swscale, so
      output is not bit-identical. Check it is visually equivalent before
      making it the default.
- [ ] Verify it does not regress when the element is small or the frame is
      already the target size.
