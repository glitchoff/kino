# 018 — Colour: LUTs and basic grading

**Status:** open
**Created:** 2026-11-08

## Problem

kino can set the colour of text and the background of a scene. It cannot change
the colour of footage, which is most of what a professional editor does.

No LUTs, no curves, no lift/gamma/gain, no white balance, no saturation. Footage
renders exactly as shot.

## Proposed

Two layers, both on the composition and per element.

**A composition grade**, applied once to the composited frame:

```ts
composition({
  grade: {
    lut: "./looks/teal-orange.cube",
    contrast: 1.1,
    saturation: 1.15,
    lift: [0.02, 0, -0.01],     // per channel, black point
    gamma: [1.0, 1.0, 0.98],
    gain: [1.05, 1.0, 0.95],
  },
});
```

**A per-element grade** for footage that needs matching to the rest:

```ts
s.video("./clip.mp4", { grade: { lut: "./looks/log-to-rec709.cube" } });
```

## How

- **LUT** → `lut3d`. Parse the `.cube` header only far enough to validate and
  resolve the path; ffmpeg does the interpolation.
- **lift/gamma/gain** → `colorlevels` (per-channel `rimin`/`rimax`/`gimin`/
  `gimax`/…), which is exactly this control set.
- **contrast/saturation** → `eq`.
- Order matters and should be fixed and documented: LUT, then levels, then
  `eq`. Getting this inconsistent between composition and element grades is the
  kind of thing that looks right on one clip and wrong on the next.

## Open questions

- **Where in the graph?** A composition grade is a single filter at the end. An
  element grade has to happen before overlay, which means it belongs to the
  element's subgraph — the same structure ticket 017 needs.
- **Do we ship LUTs?** No. A handful of free ones would help discovery but
  licensing is a trap. Document where to get them instead.
- **Is a grade animatable?** Ticket 016 would make `contrast` a keyframed
  value. `colorlevels` accepts expressions, so it is possible; worth not
  designing against.
- ~~Are `lut3d`, `colorlevels` and `eq` available?~~ **Yes** — all three
  verified in `vendor/linux/x64/ffmpeg` on 2026-11-08.
- **Does the docs site need a before/after preview?** It would be the most
  persuasive page on the site, and `docs-site/scripts/build-previews.mjs`
  already renders clips.

## Related

- Ticket 017 (blend and masks) shares the subgraph problem for per-element
  effects.
- Ticket 016 (keyframes) for animated grades.
