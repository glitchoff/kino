# 017 — Blend modes and masks

**Status:** open
**Created:** 2026-11-08

## Problem

There is no alpha compositing beyond `chromaKey`. Elements are overlaid in
`zIndex` order with a hard cut, and the only way to soften an edge is to
pre-multiply alpha into the source image.

A title over footage that should read as *part of* the image — screen-blended,
or feathered at the edges, or visible only through a circle — is not expressible.
That is the difference between a slide deck and a title card.

## Proposed

Two options on every element, both cheap:

```ts
s.image("./logo.png", {
  x: "center", y: "center",
  blend: "screen",              // how it composites onto what is beneath
  mask: { shape: "ellipse", feather: 20 },
});

s.image("./photo.jpg", {
  mask: { src: "./gradient.png", mode: "luma" },   // or from a file
});
```

**Blend modes** map directly to ffmpeg's `blend` filter, which has
`screen`, `multiply`, `overlay`, `softlight`, `hardlight`, `difference`,
`exclusion`, `darken`, `lighten`, `add`. The filter works on two video streams,
so an element with `blend` needs its own overlay pass rather than joining the
existing one.

**Masks** are `geq` for shapes and a second `blend` for luma/alpha mattes from a
file. `feather` is a blur on the mask, not on the element.

## Cost

This is where it gets awkward. Today the compiler builds one filtergraph and
layers elements onto it. `blend` needs two inputs and produces one, so each
blended element becomes a subgraph:

```
[base][element]blend=all_mode=screen[base]
```

Sequential blending of N elements is N passes, which is linear and fine. But it
means `blend` cannot be combined with the existing single-pass overlay of
unblended elements — those have to be split into runs.

## Open questions

- ~~Is `blend` in the vendored ffmpeg?~~ **Yes** — `blend` and `geq` both
  verified present in `vendor/linux/x64/ffmpeg` on 2026-11-08.
- **Does a blended element need a background?** `blend` requires both inputs to
  be the same size and format. Elements are positioned overlays, so each blended
  element needs a full-frame transparent layer first. That is a real cost per
  element and might make blending several elements slow.
- **Masks on text?** The most useful case is a gradient fade at the bottom of a
  paragraph. That should work the same way if masks are applied after
  rasterisation.
- **Does this need `group` first?** Applying one blend to five elements is much
  easier with grouping. Ticket 013 raises `group` separately and it might belong
  before this.

## Related

- Ticket 013 (shapes) — masks on shapes are more useful than masks on images.
- Ticket 018 (colour) — `lut3d` and `blend` compose the same way.
