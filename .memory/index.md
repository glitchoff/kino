# Current state

Last updated: 2026-11-07

## What kino is

Scripting-first video engine: TypeScript compositions compiled to MP4 via
FFmpeg. Published as `@glitchoff/kino`. JSON compositions are still accepted as
the legacy/interop format.

## Layout

| Path | Purpose |
| --- | --- |
| `src/pipeline/` | compile → `.kino` artifact → FFmpeg render |
| `src/normalize/` | raw input → normalized composition (units, templates, animation) |
| `src/validate/` | schema validation with `KinoValidationError` |
| `src/encoder/` | FFmpeg binary resolution, drawtext probe, hardware encoder detection |
| `src/artifact/` | `.kino` zip read/write |
| `src/remote/` | remote asset downloader |
| `src/builder/` | code-first composition builder (`composition()`, element factories, animation helpers) |
| `src/tts/` | Piper narration: `tts()` specs, `voice()` measurement, resolution before compile |
| `studio/` | Vite + React visual editor, served by `studio/server.ts` |
| `scripts/` | install helpers (ffmpeg, browser), Telegram/tmpfiles utilities |
| `test/` | vitest suites (`timeline`, `units`) |
| `docs/` | published documentation |
| `.github/workflows/` | `ci.yml` (push/PR checks), `publish.yml` (tag-triggered npm release), `telegram-render.yml` (manual) |

## Health

- `pnpm test` — 151 tests passing (10 files)
- `pnpm typecheck` — clean
- `pnpm exec tsup` — builds library + CLI
- all `examples/*.ts` compile via `--dry-run` (TypeScript compositions)
- TTS verified by real render on 2026-11-07 (Piper on PATH here)

## Uncommitted

- `trimEnd` + `mm:ss` parsing is **in progress**: types, builder, normalizer and
  validator are edited, but there are no tests or docs yet. See `tickets/006`
  ("Related work this unlocks"). `package-lock.json` is untracked — this repo
  uses pnpm, so it should probably not be committed.

## Known issues

- `publish.yml` only verifies the bundled FFmpeg on `v*` tags, so a broken
  upstream asset is not caught until release day.
- Fresh `pnpm install` on Linux previously failed because the pinned FFmpeg
  release tag was pruned upstream. Fixed in `scripts/install-ffmpeg.mjs`
  (now tracks the rolling `n8.1` assets) — see `tickets/003`.
