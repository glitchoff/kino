# 003 — Bundled FFmpeg download 404s on fresh installs

**Status:** done (verify upstream merge)
**Completed:** 2026-11-06

## Symptom

Fresh `pnpm install` on Linux failed during `postinstall`:

```
[kino] Failed to install bundled Linux ffmpeg: HTTP 404 for
https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-01-13-21/ffmpeg-n7.1.5-...tar.xz
```

## Cause

`scripts/install-ffmpeg.mjs` pinned an immutable dated autobuild tag. Upstream
prunes old autobuilds, so the pinned tag disappeared and every clean install
broke.

## Fix

Track the rolling per-branch assets instead:

```js
const FFMPEG_BRANCH = "n8.1";
const ASSETS = {
  x64: `ffmpeg-${FFMPEG_BRANCH}-latest-linux64-gpl-8.1.tar.xz`,
  arm64: `ffmpeg-${FFMPEG_BRANCH}-latest-linuxarm64-gpl-8.1.tar.xz`,
};
const BASE_URL = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest";
```

Verified locally: `ffmpeg version n8.1.3-…` with `drawtext` present.

## Trade-off

`latest` is mutable, so the exact build changes over time. That is preferable to
install breakage; the existing `verifyDrawtext()` check still guards correctness.

## Why it went unnoticed

`publish.yml` verifies the FFmpeg binary, but only on `v*` tags. Nothing
exercised the download on ordinary pushes. See `tickets/004`.
