# Done

Newest first. One line per item; link the ticket for detail.

## 2026-11-06

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
