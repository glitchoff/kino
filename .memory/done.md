# Done

Newest first. One line per item; link the ticket for detail.

## 2026-11-07

- **Word-by-word `reveal` caption style** — each word is its own element,
  appearing when sung and staying until the line ends, so the line builds up.
  The sung word is highlighted, then an overlapping element redraws it in the
  resting colour (drawtext has no per-glyph colour). Positions are explicit
  pixels from the same width estimator the renderer wraps with.
  `x` must be emitted as `w/2 ± n`: drawtext resolves `w-210` from the *right*
  edge and treats a bare negative number as a literal offset, both of which push
  words off-screen. 32 tests in `test/captions.test.ts`.
  Known gap: the estimator is a per-character approximation and can
  under-measure by ~6px per word ("Maybe" 126.7 vs 133 rendered), so with many
  words per line neighbours can touch. Fix is to calibrate advances from the
  font; the real per-character advances are 0.28–1.07em (measured).
- **`trimEnd` + `mm:ss` clock times** — `{ trimStart: "0:32", trimEnd: "0:45" }`
  plays 13s; an explicit `duration` wins. `parseDuration` accepts `mm:ss` and
  `hh:mm:ss`, throws on malformed clocks, and allows a leading component over 59
  ("90:00"). Verified the cut is real: the first output frame is pixel-identical
  to the source at 2s, not just a shortened element. 188 tests pass.
- **Full-song alignment needs chunking** — one wav2vec2 pass over a whole track
  is O(n²) in audio length and gets OOM-killed (no swap; `exit=143`). Align in
  24s windows with 4s overlap and stitch. Each window must also be given only
  ~3.2 words/second of transcript, or the model reports "no valid alignment
  path exists". A 2:43 track aligns in ~8 windows.
- **Karaoke highlight is slow on long videos** — the highlight draws one full
  frame per word (`split=N+1` plus a crop and overlay each), so a minute of
  captions is hundreds of full-resolution passes and ffmpeg can emit no frame
  for 25s+. `block` style renders the same 60s in seconds. Rework in progress:
  crop to a band around the text and do the recolour work there.
  A 60s `block` render of Co2 was delivered and looked right.
  The band rework (crop to the text band, recolour there) cuts the graph from
  202 KB to 14.8 KB and renders a 12s clip, but the frames come out **empty** —
  the band is not being pasted back correctly. Not committed; the working
  version is the full-frame one. Next step: fix the paste-back (likely the
  `drawbox`/`pad`/`overlay` sequence losing the band's alpha).
- **Word-level captions** — `captions()` (even timing, no deps) and
  `captionsAsync()` (forced alignment when `mms-forced-align` is present, even
  timing otherwise). Styles: `karaoke` (default), `word`, `block`. Timing
  weights words by length and pauses at punctuation. The aligner is optional —
  `npx kino setup captions` installs it and its model caches in
  `~/.cache/kino/captions`; nothing is required for captions to work.
  Rendering: drawtext colours a whole string, so the highlight is a second copy
  of the line cropped to the active word's box and overlaid — works with any
  font and with wrapped lines. `npx kino setup captions` installs the aligner
  into `~/.cache/kino/captions` (never the project's manifest). 24 tests in
  `test/captions.test.ts`.
  Verified by rendering and inspecting frames (karaoke on wrapped and
  single-line captions). Docs: "Word-level captions"; example
  `examples/captions.ts`.
- **Scenes sized from narration** — `await voice(text, opts)` synthesises now and
  returns a measured `Voice` (`seconds`, `path`, `spec`). `duration: { fit: voice }`
  sizes a scene to speech + `pad` (0.6s default), with `lead` and `min`; fits are
  resolved in normalization before validation, so the schema only sees numbers.
  `s.say(voice)` reuses the audio instead of re-synthesising. `wavDuration()` reads
  the length from the WAV header. 16 tests in `test/voice-duration.test.ts`
  (including a real Piper round-trip, skipped when Piper is absent). Verified by
  rendering: 1.63s + 0.60 = 2.23s scene, 4.20s total → 4.21s MP4.
  Docs: "Sizing a scene from its narration"; example `examples/narration-fit.ts`.
- **TTS via Piper** (2026-11-06 work, recorded late) — `src/tts/`, `s.say()`,
  `kino setup tts`, global voice/audio cache. — `tickets/008`
- **Reusable components** — `withDefaults()`, `.scene(scene)`, `SceneInput`
  exported. — `tickets/007`
- **yt-dlp behind `yt:`** — personal use only, `yt-dlp` must be on PATH.
  — `tickets/006`
- **`--scene <id>`** — render one scene, timeline rebased to zero.

## 2026-11-06

- **CI on push/PR** — `.github/workflows/ci.yml` runs typecheck, tests, build,
  a `--dry-run` compile of every example, and the ffmpeg `drawtext` check.
  Shares cache keys with the render workflow. — `tickets/004`
- **Preview renders, chroma key, asset cache** — `--preview [height]` downscales
  the output stage only (144p default, ultrafast); `chromaKey` on image/video
  layers composites in RGBA with optional despill; remote assets cache on disk by
  URL hash and download in parallel. — `tickets/005`
- **Scripting-first compositions** — `src/builder/` (composition builder, element
  factories, animation helpers, `defineComposition`, `toComposition`), exported
  from the package root. CLI accepts `.ts` / `.mts` / `.js` / `.mjs`.
  16 builder tests including a JSON-equivalence check. Docs and README rewritten
  around scripting; JSON marked as the legacy/interop format. — `tickets/001`
- **All examples converted to TypeScript** — `scripts/json-to-ts.mjs` converts
  legacy JSON into builder-based modules. 11 examples migrated and verified;
  `templates.json` and `html-showcase.json` dropped (template refs need
  hand-written `s.add()`). Workflow example list now points at `.ts`. — `tickets/001`
- **Telegram helper scripts** — `scripts/telegram-send.mjs` (message/file),
  `telegram-poller.mjs` (getUpdates loop), `telegram-file-sender.mjs`
  (document by default, tmpfiles link opt-in, 50 MB fallback),
  `tmpfiles-upload.mjs`. — `tickets/002`
- **Manual render CI** — `.github/workflows/telegram-render.yml` renders a chosen
  example and posts the MP4 to Telegram. Caches `node_modules` and `vendor/`,
  skips the studio build. ~30s end to end. — `tickets/002`
- **FFmpeg download fix** — pinned dated autobuild tag was pruned upstream and
  404'd on fresh installs; switched to the rolling `n8.1` assets. — `tickets/003`
- **tmpfiles status fix** — API returns `"status":"success"`, not `true`; the
  uploader treated success as failure.
