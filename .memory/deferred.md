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
