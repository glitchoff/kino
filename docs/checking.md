# Checking your work

A render is the slowest way to find out something is wrong. These three calls
answer most questions in under a second, and each reports a different kind of
mistake.

## `inspect()` — describe it without rendering

```typescript
import { inspect } from "@glitchoff/kino";

const report = inspect(comp);

for (const issue of report.issues) {
  console.log(`[${issue.severity}] ${issue.code}: ${issue.message}`);
}
// [error] text-wider-than-frame: Text is 2116px wide, wider than the 640px frame.
// [warning] element-outlives-scene: Element ends 1.50s after scene 'scene-1' and will be cut off.
// [error] missing-source: Source not found: ./missing.png
```

Synchronous, and starts nothing — no ffmpeg, no browser. Each element reports a
resolved `box` in frame pixels plus the `position` you wrote. Text width is read
from the font's advance tables, which is the number drawtext uses, so the boxes
match the render.

Issues: `text-wider-than-frame`, `text-outside-frame`, `element-outside-frame`,
`element-outlives-scene`, `element-overlap`, `missing-source`,
`transition-longer-than-scene`, `invalid-composition`.

## `measureText()` — exact text width

```typescript
const { width, source } = measureText("Maybe", { fontSize: 64 });
// { width: 202.9, source: "font" }
```

Synchronous, exact, and cheap. `source` is `"font"` when read from the file, or
`"estimate"` when the font could not be loaded and it fell back to the
character-class estimator — which is visibly wrong: on `"WWWW"` at 64px it says
205px where the real advance is 250px.

## `Preview` — scrub without rendering

```typescript
import { Preview } from "@glitchoff/kino";

const preview = await Preview.open(comp, { height: 360 });
const frame = await preview.frame(3.2);
frame.url;   // data:image/png;base64,… — straight into an <img>
preview.close();
```

Compiles once and renders a small proxy, so each frame costs ~30 ms instead of
~200 ms. The proxy is deliberately small and lossy — for judging layout and
timing, not colour.

:::preview name="feature-preview-api" caption="Preview.open() — scrubbing a composition"
:::

---
---

Next: [Rendering](./rendering.md) covers the actual encode.
