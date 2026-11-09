# 018 — Colour: LUTs and basic grading

**Status:** done (2026-11-08) — `lut`, `curves`, `balance` and a
composition-level `grade`, on top of the per-element controls that shipped
earlier.
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

## What shipped

`ColorAdjust` gained `lut`, `lutInterp`, `curves` and `balance`, and
`KinoComposition` gained `grade` (with `composition({ grade })` and
`.grade(color)`).

The order the ticket asked to pin down is now the contract, encoded once in
`buildColorFilter` and tested: **LUT → curves → lift/gain → balance → eq → hue**.
Element and composition grades go through the same function, so they cannot
drift apart.

The composition grade is a single filter after transitions and before the
preview downscale.

Answers to the open questions:

- **Where in the graph?** Composition grade is one filter at the end; element
  grades run before overlay. The subgraph work from ticket 017 made the second
  part straightforward.
- **Do we ship LUTs?** No, as proposed. The docs point at FreshLUTs, IWLTBAP and
  Resolve exports instead.
- **Animatable?** Not built. `colorlevels` and `eq` both accept expressions, so
  the seam is there; nothing was designed against it.
- **Before/after on the docs site?** Not built. Still the most persuasive thing
  the site could show, and `docs-site/scripts/build-previews.mjs` could render
  it.

Two ffmpeg details worth remembering:

- **`colorbalance` names its options channel-then-band** — `rs` is red-shadows,
  `bm` is blue-midtones. Band-first (`sr`) is not an option and fails with
  "Option not found".
- **`eq=saturation=0` is not exactly neutral.** On `#804020` it gives 77,79,76
  rather than a flat grey, because ffmpeg uses a luma-weighted desaturation.
  Close enough to read as greyscale, but a test that demands equality across
  channels will fail.

## Related

- Ticket 017 (blend and masks) shares the subgraph problem for per-element
  effects.
- Ticket 016 (keyframes) for animated grades.
