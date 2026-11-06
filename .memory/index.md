# Current state

Last updated: 2026-11-06

## What kino is

TypeScript library + CLI + local web studio that compiles declarative JSON scene
compositions into MP4 via FFmpeg. Published as `@glitchoff/kino`.

## Layout

| Path | Purpose |
| --- | --- |
| `src/pipeline/` | compile → `.kino` artifact → FFmpeg render |
| `src/normalize/` | raw input → normalized composition (units, templates, animation) |
| `src/validate/` | schema validation with `KinoValidationError` |
| `src/encoder/` | FFmpeg binary resolution, drawtext probe, hardware encoder detection |
| `src/artifact/` | `.kino` zip read/write |
| `src/remote/` | remote asset downloader |
| `src/builder/` | **code-first composition builder** (new) |
| `studio/` | Vite + React visual editor, served by `studio/server.ts` |
| `scripts/` | install helpers (ffmpeg, browser), Telegram/tmpfiles utilities |
| `test/` | vitest suites (`timeline`, `units`) |
| `docs/` | published documentation |
| `.github/workflows/` | `publish.yml` (tag-triggered npm release), `telegram-render.yml` (manual) |

## Health

- `pnpm test` — 53 tests passing
- `pnpm typecheck` — clean
- `pnpm exec tsup` — builds library + CLI in ~7s

## Known issues

- `publish.yml` only verifies the bundled FFmpeg on `v*` tags, so a broken
  upstream asset is not caught until release day.
- Fresh `pnpm install` on Linux previously failed because the pinned FFmpeg
  release tag was pruned upstream. Fixed in `scripts/install-ffmpeg.mjs`
  (now tracks the rolling `n8.1` assets) — see `tickets/003`.
