# 019 — Motion blur

**Status:** open
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
