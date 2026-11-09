# 016 — Keyframed animation with curves

**Status:** done (2026-11-08) — `keyframes` on any animated channel, plus five new easings. `{ from, to }` unchanged. Compiles to a nested `if` chain over `t` in `keyframeExpression()`.
**Created:** 2026-11-08

## Problem

`AnimationValue` is `{ from, to, duration, delay, easing }`. One segment, one
easing. That is enough for "slide in" and not enough for anything that reads as
designed: a bounce, a hold-then-move, a multi-step reveal, a value that eases in
and snaps out.

`ElementAnimation.steps` already exists, but it is a *step function* — it holds
a value until the next keyframe. Captions use it to swap which word is
highlighted. It is not a curve.

## Proposed

Keyframes become first-class, alongside the existing `from`/`to` form:

```ts
s.text("Title", {
  x: "center",
  y: "center",
  animation: {
    scale: {
      keyframes: [
        { at: 0, value: 0.8, easing: "easeOutBack" },
        { at: 0.4, value: 1.1 },
        { at: 0.7, value: 1.0, easing: "easeInOut" },
      ],
    },
  },
});
```

- `at` is seconds from the element's `startAt`, matching `steps`.
- `easing` on a keyframe describes the segment *arriving at* it, so the last
  keyframe's easing is unused.
- Omitting `easing` inherits the animation's, defaulting to `easeInOut`.
- `{ from, to }` stays exactly as it is — it is sugar for two keyframes.

## How it compiles

Values are emitted as ffmpeg expressions today. A keyframe list becomes a nested
`if(lt(t,0.4), …, …)` chain. That is already the shape the compiler uses for
`from`/`to` with delay, just deeper, so this is a widening of an existing
mechanism rather than a new rendering path.

Watch for: expression length on long keyframe lists (ffmpeg has a limit, and it
is not well documented), and precision — `t` is the *frame* time, so keyframes
between frames snap to one side.

## New easings

`easeOutBack`, `easeInBack`, `easeInOutBack`, `easeOutElastic`, `easeOutBounce`
are the ones that make motion read as designed. Each is a few lines next to the
existing `Easing` union.

## Open questions

- **Cubic bezier by control points?** `easing: [0.2, 0.8, 0.1, 1]` is what a
  designer reaches for. It is a bigger surface than named curves and needs a
  solver; could come after the named set.
- **Does `steps` merge into this?** With `step: true` on a keyframe, `steps`
  becomes a special case of keyframes and the two paths collapse. That is
  cleaner, but captions depend on `steps` today, so it needs care.
- **Property coverage.** Today only `opacity`, `x`, `y`, `scale` animate. Colour
  and `fontSize` are the next obvious ones and this is when to add them.
- **Does this block motion blur?** No — motion blur needs multiple samples per
  frame regardless of how the value is computed. But it is much easier once
  values are a function of `t` rather than a single segment.

## Related

- Ticket 017 (blend modes and masks) animates the same way once this lands.
- Ticket 018 (colour) would want animated grades, which needs this.
