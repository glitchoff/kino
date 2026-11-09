# 013 — Shapes and charts as first-class elements

**Status:** done (2026-11-08) for primitives — `rect`/`ellipse`/`line`, rasterised to PNG at compile time. The `chart` element was not built; the primitives cover it and a chart is a loop over `rect`s. `group` remains separate, as the ticket suggested.
**Created:** 2026-11-08

## Problem

There are four element types: `text`, `image`, `video`, `html`. No shapes, no
charts, no grouping.

An agent making an explainer reaches for a rectangle, a bar chart or a circle,
finds nothing, and fakes it with an `html` element. That works, but:

- it drags in a browser dependency (Chrome or Obscura) for something that should
  be a few pixels
- it is slow — an HTML element is a full page render per element
- it is fragile — HTML layout differs subtly between Chrome and Obscura, so the
  same composition can render differently depending on which is installed

## Proposed

Start with the primitives that compose into charts:

| Element | Fields |
| --- | --- |
| `rect` | `x`, `y`, `width`, `height`, `fill`, `radius`, `stroke`, `strokeWidth` |
| `ellipse` | `x`, `y`, `width`, `height`, `fill`, `stroke` |
| `line` | `x1`, `y1`, `x2`, `y2`, `stroke`, `strokeWidth` |

Then, once those exist, a `chart` element is mostly data:

```ts
s.chart({ type: "bar", data: [3, 7, 2], labels: ["a", "b", "c"], width: 600, height: 300 });
```

## Rendering

ffmpeg has no rectangle filter worth using (`drawbox` exists but is limited).
Two options:

- **Draw to a PNG at compile time**, the way captions already rasterise words,
  then overlay it. Shapes are static, so this is cheap and needs no browser.
- **Emit ffmpeg filter primitives** (`drawbox`, `geq`). No extra file, but
  awkward for rounded corners and text labels.

The PNG route is consistent with `captionImages` and avoids a second rendering
model.

## Open questions

- **Animatable?** A `rect` that grows would need one raster per frame, which is
  the cost problem `captionImages` solved by only rasterising *states*. A bar
  chart revealing left-to-right could be a scale animation on a static PNG —
  worth checking whether the existing animation system covers it.
- **Does `group` come with this?** Positioning N elements relative to each other
  is manual arithmetic today. A `group` with `x`/`y` offsets would help agents,
  but it is a bigger change than shapes — keep it separate.
- **Chart or primitives first?** Primitives are more work to use; a `chart`
  element is more useful for the actual use case. Could do `chart` first and
  let it emit `rect`s internally.

## Related

- Ticket 011 (`inspect`) should know about these for bounding-box checks.
- HTML elements and their browser dependency are covered in the Obscura work
  (`1eda462`).
