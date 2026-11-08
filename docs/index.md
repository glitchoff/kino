# Kino Documentation

**Kino** is a scripting-first video engine: write compositions in TypeScript and
compile them to FFmpeg commands that render `.mp4` videos.

It is built to be authored by an agent as much as by a person. You can ask a
composition what is wrong with it before rendering it (`inspect`), measure text
exactly without a render (`measureText`), and scrub one at ~30 ms a frame
(`Preview`) — so a mistake costs a second, not a full encode.

---

## Topics

- [Getting Started](./getting-started.md) — install, first video, and a
  task-by-task tour: content, colour, motion, sound, checking, rendering.
- [API Reference](./api-reference.md) — every exported function and option.
- [Composition Reference](./schema-reference.md) — the underlying data shape:
  scenes, elements, compositing, grading, animation, audio.
- [Kino Studio](./studio.md) — local web studio with an editor and preview
  player.

Every feature on this site has a clip beside it, rendered by the engine from a
real composition. Nothing is a mockup.

---

## Quick example

```typescript
import { composition, render, fadeIn } from "@glitchoff/kino";

const video = composition({ width: 1080, height: 1920, fps: 30 })
  .scene({ duration: 5, background: "#000000" }, (s) =>
    s.text("Hello Kino", {
      fontSize: 72,
      color: "white",
      x: "center",
      y: "center",
      animation: { opacity: fadeIn(0.6) },
    })
  )
  .build();

await render(video, { output: "./out.mp4" });
```

The same file runs from the command line:

```bash
npx kino hello.ts -o out.mp4
```

> **JSON is legacy but supported.** A composition is plain JSON-safe data, so
> object literals and `.json` files work anywhere the builder does. New features
> land in the builder first; the data shape is documented in the
> [Composition Reference](./schema-reference.md).
