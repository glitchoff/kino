# 021 — Live preview: scrub without rendering

**Status:** done (2026-11-08) — `Preview.open()` / `previewFrames()`. The spike answered the ticket's open question: spawn-per-frame cost was almost entirely process start, so a **proxy file** is the win, not a persistent process. A 640×360 proxy makes each seek ~30 ms against ~200 ms for a full-size frame — 5× cheaper from the second frame on. A persistent ffmpeg would only reach ~10 ms and was not worth the lifetime complexity.
**Created:** 2026-11-08

## Problem

The only way to see a composition is to render it. `exportComposition({ frames })`
made a still cost ~75 ms instead of ~1100 ms, which is a usable *feedback loop*
but not a *scrubber* — at 75 ms per frame you get 13 fps of one-frame-at-a-time
requests, with a process spawn and a compile in the way each time.

An editor that does not scrub is not an editor.

## Proposed

A long-lived preview process that compiles once and then serves frames on
demand:

```ts
const preview = await openPreview(comp, { scale: 0.5 });
await preview.frame(3.2);       // → PNG buffer, ~10 ms
await preview.frame(3.25);
await preview.close();
```

Or over HTTP, for a browser UI:

```
GET /preview/frame?t=3.2  → image/png
GET /preview/stream       → multipart/x-mixed-replace, MJPEG at N fps
```

`openPreview` keeps the compiled filtergraph and an ffmpeg process alive, and
feeds it `-ss` seeks on the same input rather than starting a new process per
frame. That is where the 75 ms goes today.

## What this unlocks

- The `studio/` editor gets real scrubbing instead of re-rendering.
- An agent can look at a composition at several timestamps in one cheap session.
- `--watch` rendering: change a file, see the affected scene update.

## Open questions

- **Is a persistent ffmpeg actually faster?** The measured 75 ms includes
  compile *and* process start. Needs a spike before committing: if seeks on a
  live process are not meaningfully under 75 ms, this ticket is not worth it.
- **What is the right transport?** In-process is simplest and works for
  `studio/`. HTTP is needed for anything remote and is more work.
- **Does it need the browser?** Compositions with HTML elements need one alive
  per preview session, which is a different lifetime problem from a one-shot
  render.
- **How does it interact with `frames`?** `exportComposition({ frames })` should
  probably use the same machinery internally so there is one seek path.

## Related

- `exportComposition` (shipped) is the one-shot version of this.
- Ticket 020 makes the compile step synchronous, which helps startup latency.
- `studio/` already exists and is the obvious first consumer.
