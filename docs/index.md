# Kino Documentation

**Kino** is a TypeScript library and local web studio that compiles JSON scene specifications into FFmpeg commands to render `.mp4` videos.

---

## 📚 Topics

- [Getting Started](./getting-started.md) — Installation, basic usage, and CLI overview.
- [JSON Schema Reference](./schema-reference.md) — Composition properties, scenes, and element options.
- [API Reference](./api-reference.md) — `render()`, `compile()`, and `RenderOptions`.
- [Kino Studio](./studio.md) — Local web studio with JSON editor and render preview player.

---

## Quick Example

```typescript
import { render } from "kino";

await render(
  {
    width: 1080,
    height: 1920,
    fps: 30,
    scenes: [
      {
        duration: 5,
        background: "#000000",
        elements: [
          {
            type: "text",
            content: "Hello Kino",
            fontSize: 72,
            fontColor: "white",
            x: "center",
            y: "center",
            startTime: 0,
            duration: 3
          }
        ]
      }
    ]
  },
  { output: "./out.mp4" }
);
```
