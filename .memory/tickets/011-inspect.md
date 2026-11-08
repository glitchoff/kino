# 011 — `inspect()`: describe a composition without rendering it

**Status:** open
**Created:** 2026-11-08

## Problem

An agent writing a composition has no way to ask "what will this look like?"
short of rendering. The only feedback loop is write → render → look, which costs
minutes and, when it looks at frames, image budget.

## Proposed

`inspect(composition)` returning a plain object — no ffmpeg, no browser:

```ts
const report = await inspect(comp);
// {
//   width, height, fps, duration,
//   scenes: [{ id, start, duration, background, transition, elements: [...] }],
//   issues: [...]
// }
```

Per element, what an agent actually needs to self-check:

- **bounding box** — resolved `x`/`y`/`width`/`height` in pixels, including unit
  strings (`"center"`, `"bottom-240"`, `"50%"`)
- **timing** — `startAt`, `duration`, and whether it falls outside its scene
- **text** — measured width (see ticket 012), and whether it overflows the frame
- **overlaps** — which elements collide, since that is the mistake agents make

## Issues to report

These are the things that currently only surface as a failed render or a bad
frame:

- element extends past the frame edges
- element starts before or ends after its scene
- text wider than the frame
- scene with zero duration, or a transition longer than either adjacent scene
- `src` paths that do not exist on disk

## Open questions

- **Does it validate?** `validateComposition` already reports schema errors.
  `inspect` should assume a valid composition and report *layout* problems, or
  run validation first and short-circuit. Prefer the latter — one call, not two.
- **Does it resolve units or return them raw?** Resolved pixels are what an
  agent needs, but raw values let a caller see what it wrote. Probably both:
  `x: "center"` alongside `resolved: { x: 540 }`.
- **Async?** Measuring text needs the rasteriser (ticket 012), which is async.
  So `inspect` is async even though nothing renders.

## Related

- Ticket 012 (text measurement) is a prerequisite for the text-overflow check.
- `exportComposition({ frames })` is the expensive fallback this replaces.
