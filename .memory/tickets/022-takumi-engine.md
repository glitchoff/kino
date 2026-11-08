# 022 — Takumi as an HTML engine, with browser fallback

**Status:** open
**Created:** 2026-11-08

## Problem

`type: "html"` elements render through a real browser — Chrome via Puppeteer, or
Obscura over CDP. That costs a browser dependency, a page render per element, and
a divergence: the same markup lays out slightly differently between the two
engines, so a composition can render differently depending on what is installed.

Most HTML an agent writes in kino is a title card, a chart, a stat panel — boxes
and text. None of it needs a browser.

## Proposed

[Takumi](https://takumi.kane.tw/) is a Rust layout engine (text and inline
layout ported from Blink) that renders JSX/HTML/CSS to PNG without a browser. It
handles local fonts, SVG and PNG assets natively, which is everything the HTML
path needs.

`--browser` gains a fourth value:

| Value | Behaviour |
| --- | --- |
| `chrome` | Chrome via Puppeteer (default, unchanged) |
| `obscura` | Obscura over CDP (unchanged) |
| **`takumi`** | Takumi, no browser |
| `auto` | **Takumi, falling back to Obscura/Chrome when it cannot render** |

`auto` is the one that matters: try Takumi, and if it cannot render the markup,
switch to a browser for that element. That keeps the speed and determinism for
the common case without losing the escape hatch.

## The hard part: detecting "Takumi can't"

Takumi explicitly supports less CSS than Chrome, and scripts never run. The
fallback needs a *reliable* signal, not a guess. Options, in order of preference:

1. **An explicit per-element opt-out** — `html: { engine: "browser" }`. Exact,
   and the author always knows when they need a browser.
2. **Detect known-unsupported features** before rendering — `<script>`, exotic
   selectors, unsupported properties. Fragile: the list will drift from Takumi's
   actual support.
3. **Render and inspect** — if Takumi throws, fall back. Only catches hard
   failures, not silent layout differences.

Doing 1 first and 3 as a safety net is probably right. Doing 2 alone is a
maintenance trap.

## What must be checked before this is scheduled

- **Fonts.** Takumi never reads system fonts; they are passed explicitly. kino
  ships `assets/Inter-Regular.ttf` and already stages it, so this should work —
  but verify that `@font-face`-less markup picks it up the same way the browser
  path does.
- **Assets.** Local SVG and PNG, both as `<img src>` and `background-image`.
- **Layout parity.** Render the same markup through both engines and diff the
  pixels. "Close" is not good enough for a default.
- **Speed.** Per-element browser launch is the thing this removes; measure what
  it is actually worth.
- **Bundle.** Native binding, prebuilt for linux x64/arm64, macOS, Windows. It
  sits next to ffmpeg as a second native dependency.

## Open questions

- **Does Takumi replace `shape`?** It can draw rectangles and ellipses through
  CSS. But shapes need no layout engine and are cheaper, so they should stay.
- **Should `auto` ever pick Takumi when a browser is already running?** A live
  Obscura is nearly free per element; spawning Takumi is also cheap. Probably
  prefer Takumi unless the element needs a browser.
- **What about the `--browser-url` flag?** It only means something for Obscura;
  it should be ignored, not rejected, when the engine is Takumi.

## Related

- Obscura support landed in `1eda462`; `--browser` and `--browser-url` are in
  `src/types/render.ts`.
- Shapes (`013`) exist because agents were reaching for HTML to draw boxes.
  Takumi makes HTML cheaper, but shapes are still the right tool for a
  rectangle.
