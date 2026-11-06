# FFmpeg binary resolution

Kino needs an FFmpeg build **with `drawtext`** (libfreetype + libharfbuzz) to
render text elements.

## Resolution order

`src/encoder/probe.ts` → `getFFmpegBinaryPath(customPath)`:

1. explicit `--ffmpeg-path` / `RenderOptions.ffmpegPath`
2. `FFMPEG_PATH` environment variable
3. `vendor/linux/<arch>/ffmpeg` (Linux x64/arm64 only, installed by `postinstall`)
4. `ffmpeg-static` binary
5. `ffmpeg` from `PATH`

Text compositions additionally call `assertDrawtextSupport()`, which fails loudly
if the resolved binary lacks `drawtext` — that is the error you see as
`has no drawtext support (missing libharfbuzz)`.

## Why Linux has a custom binary

`ffmpeg-static`'s Linux build predates FFmpeg 6.1, where `drawtext` requires both
`--enable-libfreetype` and `--enable-libharfbuzz`. Text renders silently blank
otherwise. Windows/macOS `ffmpeg-static` builds are fine.

## Install

```bash
node scripts/install-ffmpeg.mjs            # install / verify
node scripts/install-ffmpeg.mjs --print-path   # print the binary path only
npx kino setup ffmpeg                      # user-facing wrapper
```

The script downloads a BtbN build into `vendor/linux/<arch>/ffmpeg`, extracts it
with pure JS (`xz-decompress` + `tar`, so no system `tar`/`xz` needed), and
verifies `drawtext` before reporting success.

## Asset pinning

Tracks the rolling per-branch assets:

```js
const FFMPEG_BRANCH = "n8.1";
const ASSETS = {
  x64: `ffmpeg-${FFMPEG_BRANCH}-latest-linux64-gpl-8.1.tar.xz`,
  arm64: `ffmpeg-${FFMPEG_BRANCH}-latest-linuxarm64-gpl-8.1.tar.xz`,
};
```

**Do not** pin a dated `autobuild-…` tag. Upstream prunes them and every clean
install 404s — that is exactly what happened in `tickets/003`.

## Caching in CI

Cache `vendor/` **before** `pnpm install` so `postinstall` finds the binary and
skips the download:

```yaml
- uses: actions/cache@v4
  with:
    path: vendor
    key: ffmpeg-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('scripts/install-ffmpeg.mjs') }}
```

Keying on the script means a changed asset URL invalidates the cache.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `EXDEV: cross-device link` | `/tmp` is on a different filesystem; set `TMPDIR` inside the project |
| `HTTP 404` on download | asset URL is stale — check the BtbN release assets |
| `has no drawtext support` | wrong binary resolved; pass `--ffmpeg-path` explicitly |
