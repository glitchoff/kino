# Current state

Last updated: 2026-11-21

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
| `src/builder/` | code-first builder (`composition()`, element factories, animation helpers) and the scene-as-value API (`scene()`, `merge()`) |
| `src/animation/` | easing curves and keyframe → ffmpeg expression compilation |
| `src/tts/` | Piper narration: `tts()` specs, `voice()` measurement, and `showcase.ts` — the voice audition server |
| `src/captions/` | Word timings, karaoke/subtitle generation, `resolveCaptions()` seam |
| `src/measure/` | Font-metric text measurement (`font.ts` parses hmtx/cmap) |
| `src/inspect/` | `inspect()` — geometry and layout issues without rendering |
| `studio/` | Vite + React visual editor, served by `studio/server.ts` |
| `scripts/` | helper programs, not published: `preview/` harnesses, `showcase/`, `probe/`, installers, Telegram |
| `test/` | vitest suites, importing from `src/` |
| `test-dist/` | vitest suites against the built `dist/` (`pnpm test:dist`) |
| `docs-site/` | Astro site reading `docs/*.md`, deployed to GitHub Pages; `src/nav.ts` is the single source of sidebar order and prev/next; `src/plugins/preview-directive.mjs` embeds clips |
| `.github/workflows/` | `ci.yml`, `docs.yml`, `publish.yml`, `telegram-render.yml` |

## Health

- `pnpm test` — 398/455 passing, **5 failures**: 1 export (`frames are named from
  the timestamp`), 4 ytdlp (a Windows/vitest stub problem — see the 2026-11-21
  findings entry; the tests' *cause* changed this session, not the count)
- `pnpm test:dist` — 9 tests against the built bundle
- `pnpm typecheck` — clean
- `pnpm exec tsup` — builds library + CLI
- all 18 `examples/*.ts` compile via `--dry-run`
- docs site builds 12 pages, 27 preview clips; CI runs `test:dist` as its own step
- preview verified on the real chapter: **`ALL FRAMES OK`** — 360p, 921,600 B per
  frame, 1–8 ms sequential, ~1.4 s per jump. Build: 196 s for 177 s of video.

## Open

Only what is genuinely still to do. Completed work lives in `done.md`; a ticket
marked done is closed. Per-session detail: [`changelog-2026-11-20.md`](./changelog-2026-11-20.md).

| # | Ticket | What remains |
| --- | --- | --- |
| **009** | Docs rewrite | Rewritten to task-first structure on 2026-11-08. Site polish (search, syntax highlighting) still open. |
| **023** | Still input lifetime | `trim=end` on the still branch so a panel stops decoding when it leaves the screen. Shipped in `613f948`. |
| **024** | Preview resolution | `--preview` composites at the preview size instead of downscaling at the end. 36 s bench: 20.4 s at 144p. |
| **025** | `zoompan` scale | Linear 1–10 scale ramps on opaque full-frame images compile to `zoompan`, ~2× faster, parity verified to 1–2 px. |
| **026** | GPU `scale_cuda` | Measured: `scale_cuda` ~3× faster in isolation but **slower end to end** (44.5 s vs 39.1 s); `overlay_cuda` slower still. Shipped default-off. |
| **027** | Incremental render | Segment cache by scene hash. Hash/plan written; blocked on transitions, which overlap their neighbours. |
| **028** | Merge static layers | One overlay per scene instead of per layer, merging only provably-static groups. Proposed. |
| **029** | Scratch on fast storage | **Done 2026-11-21.** All eight `tmpdir()` sites now use `scratchDir()`; `Preview.open` adds an `exit` hook so a killed server cannot leave its proxy behind. |
| **030** | Assets in RAM, batched | Hold staged assets in memory under a byte budget; spill to disk when a scene exceeds it. Proposed. |
| — | **Segment cache for the proxy** | Not a ticket yet. `renderSegmented` + `cacheDir` so an edit re-renders only changed scenes. The proxy build is 196 s for 177 s of video and is the only slow part left; this is the real fix. |
| — | **Timeline UI** | Scene labels, audio strip from `audio-levels.ts` (written, not wired), current-scene indicator. |
| — | **Pocket TTS for the chapter** | Works over HTTP on `localhost:8200`. `chapter.mts` still needs rewiring to `pocket(...)`, and the 27 voices need auditioning per character. |
| — | **Showcase engines** | `http` engines work; add others by pointing `http.url` at a server. A `command` engine still needs a script in the composition's project, which kino cannot write. |
| — | **4 ytdlp tests** | Stub loses to the installed `.exe` via PATHEXT; `KINO_YTDLP` override added but the failure persists under vitest only. Isolate before closing. |

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
- **`drawtext` costs ~4 filters per karaoke word** — `split`, `crop`, a second
  `drawtext` in the highlight colour, `overlay`. Measured on a real 101-caption
  chapter: **656 `drawtext`, 554 `crop`, 602 `overlay`** in one serial chain.
  The render stalls on text, not on the encoder. `render: "gpu"` is the opt-in
  escape (see `docs/content.md` § "GPU text (opt-in)"); it draws **fill only**,
  so a caption needing a stroke stays on `drawtext` for now.

## Conventions worth knowing

- **Servers need a start path that outlives the agent's shell.** A background
  job dies when its timeout expires and takes the listening server with it —
  silently. Use the `.cmd` scripts in `scripts/`: `start-preview.cmd` (:8000),
  `start-pocket.cmd` (:8200), `start-showcase.cmd` (:4100). To hand a server
  over from an agent turn, spawn it with PowerShell `Start-Process` (unowned, so
  it survives) rather than the shell tool's background mode (owned, so it does
  not). "It responded once" is not verification; "it will still be running when
  the user tries it" is.
- **Pocket TTS answers an unknown voice name with `VOICE_CLONING_UNSUPPORTED`.**
  It treats the name as a path and falls through to cloning, which needs gated
  weights. The message reads like a permissions problem; the real cause is a
  bad voice name, or a server that has not loaded its catalog yet.

- **On the GPU: upload to scale, download to overlay.** Measured on an RTX 3050
  4 GB, 300 frames at 1080p: CPU scale+overlay 10,949 ms, `scale_cuda`+CPU
  overlay **3,613 ms**, `scale_cuda`+`overlay_cuda` 12,312 ms. `scale_cuda` is
  ~3× faster; **`overlay_cuda` is slower than the CPU**. Two uploads and a
  download per frame cost more than the composite saves. `drawtext`, `zoompan`
  and `geq` have no CUDA variants, so any of them forces a download anyway —
  the win is the resample alone. See `tickets/026`.
- **A faster filter is only an optimisation if the picture matches.** `zoompan`
  was 2.5× faster than `scale` and looked like a free win; the first parity check
  said the motion went the opposite way. It didn't — the check compared a
  top-left anchor against a centred one. Measure the *output*, not the timing,
  and make sure both sides are anchored the same way. See `tickets/025`.
- **Read the ffmpeg filter docs for the option's range.** `zoompan`'s `z` is
  documented as 1–10; `popIn` starts at 0.8, so it can never use the fast path.
  A clamp would have changed the animation silently.

- **Paths are found by walking up to the package root.** Four bugs shipped from
  assuming a fixed depth, all silent, because the suite imports from `src/` and
  never sees `dist/`. `test-dist/` exists to catch the next one.
- **Measure, don't assume.** Several fixes this week came from rendering a flat
  colour and reading the pixel, or from timing a real run. The ffmpeg docs were
  wrong twice about `colorlevels`; the tests caught it, the reading did not.
- **Scenes are values.** `scene({ for, bg }, elements)` returns the same
  `KinoScene` the builder makes, and `merge(...)` joins scenes, compositions,
  builders and nested arrays into one `KinoComposition`. The builder cannot
  express a reusable scene — `.scene()` returns the composition, so the scene
  never has a name — which is why `merge(chorus, chorus)` exists. Both are thin
  functions over the existing types; a merged composition compiles to the same
  filtergraph as the chained form, asserted in `test/scene-value.test.ts`.
- **Reusable pieces sit next to `scene()`.** `preset()` (merges nested option
  groups, which `withDefaults` does not), `withOptions()` (dresses an element
  after it was made), `elements()` (flattens elements/groups/lazy factories),
  `shift()` (moves an animation in time), `repeat()` (plays a scene again) and
  `variants()` (several scenes sharing props). All thin functions over the
  existing types; `test/reusable.test.ts`.
- **`withOptions` must map renamed text options** (`color` → `fontColor`,
  `align` → `textAlign`) and wrap a bare `AnimationValue` as
  `{ opacity: … }`. Skipping either fails *silently*: the option is dropped and
  the element renders unstyled, which no type check catches.
- **`scene()` has no `say()`.** Narration is scene-shaped (it sizes the scene),
  so a scene value cannot currently hold speech. Unresolved, not an oversight.
- **Do not rename `element` to `layer`.** Asked for and explicitly declined
  twice; an attempt was made anyway and reverted uncommitted on 2026-11-08. The
  types stay `TextElement`, `ElementInput`, `BaseElement`, and scenes keep
  `elements`. A future session seeing "element" and proposing a rename is
  repeating a rejected change.
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
