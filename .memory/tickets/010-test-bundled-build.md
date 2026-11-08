# 010 — Test the bundled build, not just src

**Status:** done (2026-11-08) — `test-dist/bundled.test.ts`, run by `pnpm test:dist` (which builds first) and by CI. Eight tests against `dist/`, not `src/`. Both historical bugs were reintroduced to confirm the suite catches them: the ffmpeg depth bug fails three tests including an end-to-end render (`ffmpeg exited 8`), the font filename bug fails the `fontfile=` assertion.
**Created:** 2026-11-08

## Problem

Two bugs shipped today with the same shape, and the test suite could not have
caught either:

- `renderHtmlBatchSync` resolved `../../../scripts/render-html.mjs` from
  `__dirname`. Correct from `src/pipeline/elements/`, wrong from `dist/` —
  where it resolved to `/scripts/render-html.mjs` and every HTML element
  render failed with a missing module. Fixed in `1eda462`.
- `resolveVendoredFFmpeg` resolved `../../vendor` from `__dirname`. Correct from
  `src/encoder/`, wrong from `dist/` — where it looked for `/workspaces/vendor`,
  found nothing, and silently fell back to `ffmpeg-static`. That build has no
  `drawtext`, so **every text render from the bundle failed**. Fixed in
  `8fe6bcb`.

The second one is the dangerous case: it failed *silently* by falling back, so
nothing surfaced until a render produced the wrong result or errored deep in
ffmpeg.

## Why the suite missed it

`vitest` imports from `src/`, so `__dirname` is always the source layout. The
bundled layout — `dist/` with hashed chunks — is never exercised. Both bugs are
invisible to every existing test by construction.

## Proposed

A small suite that runs against `dist/` after a build:

- `render()` a composition containing a text element and an HTML element
- assert the render exits 0 and the output is non-empty
- assert the resolved ffmpeg path is the vendored one, not `ffmpeg-static`, on
  Linux (this is what catches the silent fallback)
- run it in CI after `pnpm exec tsup`, so it gates every push

Open questions:

- **Where does it live?** A separate `test-dist/` run in CI, or a vitest project
  with a different include? It must not slow the main suite, which is already
  ~80s.
- **Does it need a browser?** The HTML half needs Chrome or Obscura. On CI that
  means either installing Chrome (slow) or running Obscura (a ~70 MB download).
  If neither is acceptable, cover the text path only — that still catches the
  ffmpeg one, which is the silent failure.
- **Should `resolveVendoredFFmpeg` throw instead of falling back?** Falling back
  to a binary without `drawtext` is never correct on Linux when the package
  ships one. A loud error would have surfaced this immediately. Worth deciding
  alongside this ticket.

## Related

- `findDrawtextFfmpeg` in `src/captions/index.ts` already walks up to the
  package root; three modules now solve the same problem three ways.
- Ticket 009 (docs rewrite) is unrelated but was deferred first.
