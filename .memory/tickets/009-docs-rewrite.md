# 009 — Rewrite the docs and finish the docs site

**Status:** deferred
**Created:** 2026-11-08

## Why deferred

The content is out of date in places and the site is thin, but neither blocks
anyone today. Better to do this once, after the features it would document
(the caption seam, HTML fallback) have settled, than to rewrite twice.

## Problem

The docs grew feature by feature and now read as an accumulation rather than a
guide:

- **Structure is chronological, not task-based.** `getting-started.md` is 600+
  lines covering install, the builder, captions, TTS, transitions, the studio
  and the CLI in one file. A reader looking for one thing has to scan all of it.
- **The site is a thin skin over the markdown.** `docs-site/` renders
  `docs/*.md` with a sidebar and nothing else: no search, no code highlighting,
  no prev/next, no landing page that sells the engine.
- **Previews only cover transitions and animations.** Captions, TTS, chroma
  key, scene selection and the builder have no visual example, and those are
  harder to explain in prose than a transition is.
- **`.memory/guide/` and `docs/` have diverged.** Both describe captions and
  neither is the obvious source of truth.
- **`schema-reference.md` is raw.** It documents the `KinoComposition` shape but
  has no worked examples, and the builder is the recommended path anyway.

## Proposed shape

Split by task rather than by feature:

| Page | Covers |
| --- | --- |
| Getting started | install, one composition, render it |
| Guides | captions, TTS, HTML, video, audio, transitions — one page each |
| API reference | generated or hand-kept, per export |
| Schema | the JSON shape, for interop |
| Studio | the editor |

Site work that goes with it:

- Code highlighting (Astro ships Shiki; it is a config line, not a dependency)
- Search — a static index is enough for this size
- Prev/next links, and a landing page with a real demo
- Previews for captions and TTS, not just transitions

## Decisions needed

- **Generated or hand-written API reference?** `schema-reference.md` could be
  generated from the types; the API reference probably cannot.
- **Does `.memory/guide/` survive?** If the docs cover it, the memory copy is
  duplication that will drift again.
- **Rewrite or restructure?** Much of the prose is fine; it may be a move-and-
  split job rather than a rewrite.

## Related

- The docs site was added in `f898abf` and fixed in `2d0157b`.
- Previews landed in `00ab818`, embedded in tables in `74c49d0`.
- Ticket 008 (TTS) deferred Edge/Kokoro; that page would need the same treatment
  if those land.
