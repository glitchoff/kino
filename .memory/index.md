# Current state

Last updated: 2026-11-08

## What kino is

Scripting-first video engine: TypeScript compositions compiled to MP4 via
FFmpeg. Published as `@glitchoff/kino`. JSON compositions are still accepted as
the legacy/interop format.

Agents are the primary author. That shapes the design: `inspect()` and
`measureText()` answer questions without rendering, `Preview` scrubs at ~30 ms a
frame, and `s.tak()` renders HTML with no browser to install.

## Layout

| Path | Purpose |
| --- | --- |
| `src/pipeline/` | compile → `.kino` artifact → FFmpeg render |
| `src/pipeline/elements/` | per-element filters: text, media, html, takumi, shapes, color, blend |
| `src/pipeline/preview.ts` | `Preview` — proxy-backed frame scrubbing |
| `src/normalize/` | raw input → normalized composition (units, templates, animation, ducking) |
| `src/validate/` | schema validation with `KinoValidationError` |
| `src/encoder/` | FFmpeg binary resolution, drawtext probe, hardware encoders, `--crf` flags |
| `src/artifact/` | `.kino` zip read/write |
| `src/remote/` | remote asset downloader; `ytdlp.ts` and `takumi.ts` prefix helpers |
| `src/builder/` | code-first builder (`composition()`, element factories, animation helpers) |
| `src/animation/` | easing curves and keyframe → ffmpeg expression compilation |
| `src/tts/` | Piper narration: `tts()` specs, `voice()` measurement |
| `src/captions/` | Word timings, karaoke/subtitle generation, `resolveCaptions()` seam |
| `src/measure/` | Font-metric text measurement (`font.ts` parses hmtx/cmap) |
| `src/inspect/` | `inspect()` — geometry and layout issues without rendering |
| `studio/` | Vite + React visual editor, served by `studio/server.ts` |
| `scripts/` | install helpers (ffmpeg, browser, obscura), Telegram utilities |
| `test/` | vitest suites, importing from `src/` |
| `test-dist/` | vitest suites against the built `dist/` (`pnpm test:dist`) |
| `docs-site/` | Astro site reading `docs/*.md`, deployed to GitHub Pages; `src/nav.ts` is the single source of sidebar order and prev/next; `src/plugins/preview-directive.mjs` embeds clips |
| `.github/workflows/` | `ci.yml`, `docs.yml`, `publish.yml`, `telegram-render.yml` |

## Health

- `pnpm test` — 365 tests passing (25 files)
- `pnpm test:dist` — 9 tests against the built bundle
- `pnpm typecheck` — clean
- `pnpm exec tsup` — builds library + CLI
- all 18 `examples/*.ts` compile via `--dry-run`
- docs site builds 6 pages; CI runs `test:dist` as its own step

## Open

Only what is genuinely still to do. Completed work lives in `done.md`; a ticket
marked done is closed.

| # | Ticket | What remains |
| --- | --- | --- |
| **009** | Docs rewrite | Rewritten to task-first structure on 2026-11-08. Site polish (search, syntax highlighting) still open. |

Deliberately out of scope: adjustment layers, nesting, speed ramps, time
remapping. Real editor features that restructure the scene model; none unblock
the common cases.

## Known issues

- **CI workflow dispatch needs a `workflow`-scoped token.** A `ghu_` App token
  can push but returns 403 on `/actions/workflows/*/dispatches`. Use a classic
  `ghp_` token with `workflow`.
- **Telegram chat is a supergroup.** The ID is `-1004377515630`; the older
  `-5371873302` returns "group chat was upgraded to a supergroup".
- **`publish.yml` only verifies the bundled FFmpeg on `v*` tags**, so a broken
  upstream asset is not caught until release day.
- **Chrome cannot launch in this dev container** (`libatk-1.0.so.0` missing).
  Obscura works; `s.tak()` needs neither.
- **The caption suite takes ~145 s** — `captionImages` rasterises one PNG per
  word. It dominates `pnpm test`.

## Conventions worth knowing

- **Paths are found by walking up to the package root.** Four bugs shipped from
  assuming a fixed depth, all silent, because the suite imports from `src/` and
  never sees `dist/`. `test-dist/` exists to catch the next one.
- **Measure, don't assume.** Several fixes this week came from rendering a flat
  colour and reading the pixel, or from timing a real run. The ffmpeg docs were
  wrong twice about `colorlevels`; the tests caught it, the reading did not.
- **`tak:` is opt-in per element**, not a flag. A flag would make output depend
  on how the process was started.
- **Astro's Smartypants runs before remark plugins.** Any plugin matching `"`
  in markdown must also accept `“ ”`, or it silently finds nothing and passes
  the markup through. Cost an hour once; see `preview-directive.mjs`.
- **Markdown rendered by `<Content />` carries no Astro scope attribute.** A
  scoped rule like `.doc > :not(.toc)` matches nothing on it, so `order`,
  layout and spacing rules silently do nothing. Use `:global()` for slot
  content.
- **Design direction for the docs site** (unslop, run 2026-11): character
  `precise, mechanical, a little dry`; world = timeline / render queue;
  signature = the playhead (wordmark, active sidebar row, section rules, TOC
  numbers). Ink ramp, sky-blue accent, Geist + Geist Mono self-hosted from
  `docs-site/public/fonts`. Keep chrome neutral; the preview clips are the only
  thing carrying colour.
- **Astro caches rendered markdown** in `docs-site/node_modules/.astro/`, not
  only `.astro/` at the site root. Deleting `dist/` is not enough to see a
  plugin change — clear both, or the old HTML is reused and the plugin looks
  broken.
