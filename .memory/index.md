# Current state

Last updated: 2026-11-08

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
| `src/captions/` | Word timings (even or aligned) and karaoke/subtitle element generation |
| `src/measure/` | Rasterised text measurement (`measureText`, `measureTexts`, `measureSpace`) |
| `src/inspect/` | `inspect()` — composition geometry and layout issues without rendering |
| `studio/` | Vite + React visual editor, served by `studio/server.ts` |
| `scripts/` | install helpers (ffmpeg, browser), Telegram/tmpfiles utilities |
| `test/` | vitest suites; imports from `src/`, so the bundled `dist/` layout is never exercised (ticket 010) |
| `docs/` | published documentation |
| `.github/workflows/` | `ci.yml` (push/PR checks), `publish.yml` (tag-triggered npm release), `telegram-render.yml` (manual) |

## Health

- `pnpm test` — 257 tests passing (17 files)
- `pnpm typecheck` — clean
- `pnpm exec tsup` — builds library + CLI
- all 16 `examples/*.ts` compile via `--dry-run` (TypeScript compositions)
- TTS verified by real render on 2026-11-07 (Piper on PATH here)

## Uncommitted

- Nothing. `trimEnd` + `mm:ss` landed on 2026-11-07 (see `done.md`).
  `package-lock.json` is untracked — this repo uses pnpm, so it should probably
  not be committed.

## Deferred

- **Docs rewrite and site polish** — see `tickets/009`. The content is
  chronological rather than task-based and the site is a thin skin over the
  markdown (no search, no highlighting). Deliberately held until the caption
  seam and HTML fallback settle, so it is not rewritten twice.

## Open

### Pro-editor features (2026-11-08)

Planned as a track toward a professional video editor, ordered by
value-per-unit-work and by dependency. Each ticket states what it is for, how it
compiles, and what to check before scheduling it.

**Next, in this order:**

1. ~~**`tickets/015` — audio ducking.**~~ **Done 2026-11-08.**
2. ~~**`tickets/016` — keyframed animation with curves.**~~ **Done 2026-11-08.**
3. **`tickets/020` — replace rasterised text measurement with font parsing.**
   The rasteriser shipped in `3a938ae` works but shells out per string, measures
   ink extent rather than advance width, and degrades silently. Parsing
   `hmtx`/`cmap` is exact, synchronous, and makes `inspect()` sync too. Worth
   doing before anything depends on the current API.

**Then, once 016 lands:**

4. **`tickets/017` — blend modes and masks.** No compositing beyond chroma key.
   Needs the subgraph work that 016's expression model makes natural.
5. **`tickets/018` — colour: LUTs and grading.** `lut3d` + `colorlevels` + `eq`.
   Cheap to add, large visual payoff, and the docs site could show before/after.
6. **`tickets/019` — motion blur.** Sub-frame sampling, averaged. The cheapest
   thing that stops output looking generated, but it needs values as `f(t)`,
   which is 016.

**Bigger, not yet scheduled:**

- **`tickets/021` — live preview.** Needs a spike first: the 75 ms still cost
  includes compile and process start, and it is not established that a live
  ffmpeg seek is meaningfully cheaper.

**Explicitly out of scope for now:** adjustment layers, nesting, speed ramps and
time remapping. Real editor features, but they restructure the scene model and
none of them unblock the common cases above.

### Everything else

- **Test the bundled build** — see `tickets/010`. Three rounds of bugs shipped
  that the suite could not catch by construction: it imports from `src/`, so
  `__dirname` is always the source layout and the `dist/` layout is never
  exercised. The worst one failed silently by falling back to a binary without
  drawtext; the next three returned relative paths that `spawn` resolved against
  the caller's cwd.
- **Shapes and charts** — see `tickets/013`. No `rect`/`ellipse`/`line`, so
  agents fake them with HTML, which pulls in a browser and renders differently
  between Chrome and Obscura.
- **Caption pipeline duplication** — see `tickets/014`. `captionImages`
  re-implements grouping, defaults and anchoring instead of sharing them with
  the text path, and that duplication already caused the stacked-captions bug.
  Ticket 020 removes most of the reason for the duplicate rasteriser.
- **Agent feedback loop** — `tickets/011` (`inspect()`) and `tickets/012`
  (`measureText()`) both landed on 2026-11-08. An agent can now describe a
  composition without rendering it.

## Known issues

- **CI workflow dispatch needs a `workflow`-scoped token.** A `ghu_` App token
  can push but returns 403 "Resource not accessible by integration" on
  `/actions/workflows/*/dispatches`. Use a classic `ghp_` token with `workflow`.
- **Telegram chat is a supergroup.** The ID is `-1004377515630`; the older
  `-5371873302` now returns "group chat was upgraded to a supergroup".

- `publish.yml` only verifies the bundled FFmpeg on `v*` tags, so a broken
  upstream asset is not caught until release day.
- Fresh `pnpm install` on Linux previously failed because the pinned FFmpeg
  release tag was pruned upstream. Fixed in `scripts/install-ffmpeg.mjs`
  (now tracks the rolling `n8.1` assets) — see `tickets/003`.
