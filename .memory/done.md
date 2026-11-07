# Done

Newest first. One line per item; link the ticket for detail.

## 2026-11-07

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
