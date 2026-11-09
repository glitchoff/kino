# 019 — Motion blur

**Status:** done (2026-11-08) — `motionBlur` on every element.

The ticket's design was **wrong**, and measuring showed it. It proposed
rendering the element N times at sub-frame offsets and combining with `blend`.
That does not work in ffmpeg: chaining `blend=addition` past **two** RGBA
inputs produces a full-frame smear (verified: 2 samples give a correct 44px
smear, 3 samples give 0..319), and `mix` averages alpha as well as colour, so
the element goes translucent instead of smeared.

What works is the tool the ticket dismissed. `tmix` on the **whole frame** is
wrong for the reason given — it drags trails behind everything. But applied to
the element's **own transparent layer** there is nothing else in the picture,
so averaging successive frames of that layer is exactly a shutter. One overlay
plus one `tmix`, no extra decode, and the smear scales cleanly: a 40px square at
520px/s goes 40px → 127px (4 samples) → 243px (8) → 328px (16).

Answers to the open questions:

- **Element or scene property?** Element, as the ticket guessed. Scene-level
  inheritance is not built; it can be added later without changing this.
- **Shutter angle?** Both. `motionBlur: 8` is samples with a 180° shutter;
  `{ samples, shutter }` sets the exposure, and `shutterFromDegrees()` converts
  from degrees.
- **Keyframes?** Independent — blur samples the rendered layer, not the
  animation curve, so it works with any animation.
- **Cost?** Measured at roughly 1.5× for four samples, not 4×, because the
  samples share the element's decode.
- A blurred element fades in over its first `frames` frames, since the running
  average needs that many to fill. Invisible on a moving element.
**Created:** 2026-11-08

## Problem

Every animation is frame-exact and therefore mechanical. A title sliding in has
a crisp edge at every position; a real camera would smear it. Professional
motion has blur, and kino cannot produce any.

This is the single cheapest thing that makes output stop looking generated.

## Proposed

Per-element, off by default:

```ts
s.text("Title", { animation: { x: { from: -400, to: 0, duration: 0.6 } }, motionBlur: 4 });
```

`motionBlur` is the number of samples per frame. `4` is a good default when on;
`8` is smooth; `16` is diminishing returns and 16× the render cost for the
blurred elements.

## How

ffmpeg has `tmix`, which averages the last N frames — but it blurs the *whole*
frame and drags trails behind the element, which is wrong. The correct approach
is to sample the element's transform at sub-frame times and average those
samples:

- Render the element N times per frame at `t + i/N * shutter` and `blend` them
  with `all_mode=average`.
- That is N× the element's cost and none of the rest.

`minterpolate` is the other option and is much worse here: it is slow, it
hallucinates, and it cannot know the element moved.

## Open questions

- **Is this an element property or a scene property?** A real shutter is
  scene-wide. But blurring an element that did not move is wasted work, so
  per-element is the honest default and a scene-level default could inherit
  down.
- **Shutter angle?** `motionBlur: 4` says nothing about *how much* time to
  sample. A `shutter: 180` (degrees, half a frame) is the film convention and
  more correct. Probably needs both: `motionBlur: { samples: 4, shutter: 180 }`.
- **Does it interact with keyframes?** It needs values at arbitrary times, which
  ticket 016's function-of-`t` model gives for free. With today's single-segment
  animation it is still possible but there is no reason to do it first.
- **Cost check.** A 4-sample blur on one element over a 60s video is 4× that
  element's filter work. Worth measuring before promising it is cheap.
- ~~Are `tmix` and `minterpolate` available?~~ **Yes**, but neither is the right
  tool here — see above.

## Related

- Ticket 016 (keyframes) — blur is much cleaner once values are `f(t)`.
- Ticket 017 (blend) — the averaging step uses `blend`, so it shares the
  subgraph work.
