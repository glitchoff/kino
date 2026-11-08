# 022 — `takumi` element: browserless HTML

**Status:** open
**Created:** 2026-11-08

## Problem

`type: "html"` renders through a real browser — Chrome via Puppeteer, or Obscura
over CDP. That costs a browser dependency, a page render per element, and a
divergence: the same markup lays out slightly differently between the two
engines, so a composition can render differently depending on what is installed.

Most HTML an agent writes in kino is a title card, a chart, a stat panel — boxes
and text. None of it needs a browser.

## Proposed

A separate element type. Not an engine behind `html`, not a flag.

```ts
s.takumi(markup, { width: 800, height: 400 })
```

- **Never uses a browser.** That is the entire point.
- **`html` is unchanged** — Chrome or Obscura, full CSS, scripts if you want
  them.
- **No detection, no fallback, no `auto`.** The rule is one sentence: `html`
  needs a browser, `takumi` does not. If Takumi cannot render your markup, use
  `html`.

[Takumi](https://takumi.kane.tw/) is a Rust layout engine with text and inline
layout ported from Blink. It renders HTML/CSS/JSX to PNG, handles local fonts,
and takes SVG and PNG assets natively.

## Why an element and not a flag

A flag means every `html` element's rendering depends on how the process was
started. Two runs of the same composition produce different output, and an
`auto` mode has to guess whether Takumi "can" render a given piece of markup —
a guess that will drift from Takumi's actual support.

An element makes the choice explicit and local, and keeps `html` working exactly
as it does today.

## What must be checked before building

- **Fonts.** Takumi never reads system fonts; they are passed explicitly. kino
  ships `assets/Inter-Regular.ttf` and already stages it. Confirm that markup
  with no `@font-face` picks it up.
- **Assets.** Local SVG and PNG, both as `<img src>` and `background-image`.
- **Layout parity.** Render the same markup through Takumi and Chrome and diff
  the pixels. Not for correctness — they are different engines — but to know
  what will look different so it can be documented.
- **Speed.** Per-element browser launch is what this removes; measure the gain.
- **Bundle.** Native binding, prebuilt for linux x64/arm64, macOS, Windows. A
  second native dependency next to ffmpeg.

## Open questions

- **Does it replace `shape`?** Takumi can draw rectangles and ellipses through
  CSS, but shapes need no layout engine and are cheaper. Shapes stay.
- **Should `takumi` and `html` share the same options?** `width`, `height`,
  `fit`, `backgroundColor`, `deviceScaleFactor` all make sense. `deviceScaleFactor`
  maps to Takumi's scale factor for crisp text.
- **Is the native binding optional?** A user who never writes `takumi` should not
  need it. Lazy-require it, so it is only loaded when the element exists.
- **What is the element called?** `takumi` names the implementation rather than
  the intent. `layer` or `box` would describe it better but are vaguer. Leaning
  `takumi` for honesty.

## Related

- Shapes (`013`) exist because agents were reaching for HTML to draw boxes.
  Takumi makes HTML cheaper, but a rectangle is still cheaper as a shape.
- Obscura support landed in `1eda462`.
