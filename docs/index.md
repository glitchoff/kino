# Kino Documentation

**Kino** is a scripting-first video engine: write compositions in TypeScript and compile them to FFmpeg commands that render `.mp4` videos.

---

## 📚 Topics

- [Getting Started](./getting-started.md) — Installation, code compositions, and CLI overview.
- [API Reference](./api-reference.md) — Builder, `render()`, `compile()`, and `RenderOptions`.
- [Schema Reference](./schema-reference.md) — The underlying `KinoComposition` shape (also the JSON format).
- [Kino Studio](./studio.md) — Local web studio with editor and render preview player.

> JSON compositions remain fully supported. They describe the same
> `KinoComposition` object the builder produces, so the two are interchangeable.

---

## Quick Example

```typescript
import { composition, render } from "@glitchoff/kino";

const video = composition({ width: 1080, height: 1920, fps: 30 })
  .scene({ duration: 5, background: "#000000" }, (s) =>
    s.text("Hello Kino", {
      fontSize: 72,
      color: "white",
      x: "center",
      y: "center",
      startAt: 0,
      duration: 3,
    })
  )
  .build();

await render(video, { output: "./out.mp4" });
```
