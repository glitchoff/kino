# Deferred

Things we consciously chose not to do yet. Each entry records **why**, so the
decision is not re-argued from scratch later.

## GPU rendering in CI

Hosted GitHub runners have no GPU. Rendering there is CPU-only (`libx264`).
Running on a self-hosted GPU box is possible but adds maintenance; not worth it
until render times on real projects become a bottleneck.

## Storing renders as release assets

The manual workflow uploads the MP4 as a workflow artifact (7-day retention) and
sends it to Telegram. Publishing to GitHub Releases would make renders permanent
but clutters the release list; revisit if renders need to be shared long-term.

## A persistent Telegram bot daemon

The poller is a foreground script that reads `getUpdates`. A long-running daemon
with command routing (`/render`, `/status`) would be nicer, but it needs a host
that stays up. Deferred until there is somewhere to run it.

## Code-first compositions beyond the builder

A full JSX-like DSL or a reactive scene graph is out of scope. The builder emits
plain `KinoComposition` objects, which keeps JSON and code interchangeable and
avoids a second rendering model.

## Removing JSON input

JSON is deprecated as an authoring format but intentionally still works — the
`.kino` artifact manifest is JSON, the studio reads and writes it, and existing
projects depend on it. Dropping the parser would be a breaking change with no
upside; it stays frozen instead.

## Studio editing `.ts` compositions

The studio currently edits JSON. Loading and saving TypeScript compositions
needs a code editor surface and a way to run the module in the browser, which is
a separate piece of work.

## Chunked alignment inside the library

`captionsAsync()` aligns the whole audio in one pass. That is O(n²) in audio
length, so a full song needs more memory than a small machine has and gets
OOM-killed. Chunking into overlapping windows works and is what the full-song
lyric experiments use, but it is currently done in a script, not in `kino`.
Moving it into `src/captions/` would make long inputs "just work"; deferred
because it needs its own design (window sizing, overlap, word-budget per window)
and tests, and captions on TTS-length audio are unaffected.

## Glyph-accurate text measurement

`estimateTextWidth` weights characters by rough class (wide/narrow/uppercase).
It is within ~5% for a line but can be off by 6px for a single word, which is
enough to make neighbouring words in the `reveal` style touch. The real
advances have been measured from Inter (0.28–1.07em per character). Adopting
them is deferred until a table-driven estimator can be added without
hand-maintaining one entry per glyph; the fallback must stay reasonable for
fonts other than Inter.
