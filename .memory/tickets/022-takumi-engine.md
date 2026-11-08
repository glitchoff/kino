# 022 — `tak:` prefix: browserless HTML

**Status:** done (2026-11-08) — `s.tak()` / `takumi()` / `html("tak:…")`. `takumi-js` 2.20.0 added as a dependency; it installs a prebuilt native binding, no browser download. Verified by render: a panel and its Inter-set text drew with no browser involved.
**Created:** 2026-11-08

## Problem

`type: "html"` renders through a real browser — Chrome via Puppeteer, or Obscura
over CDP. That costs a browser dependency, a page render per element, and a
divergence: the same markup lays out slightly differently between the two
engines, so a composition can render differently depending on what is installed.

Most HTML an agent writes in kino is a title card, a chart, a stat panel — boxes
and text. None of it needs a browser.

## Proposed

Two builder methods that coexist, both producing an `html` element:

```ts
s.html(markup, { width, height });   // browser: Chrome or Obscura
s.tak(markup, { width, height });    // Takumi: no browser
```

`s.tak()` is sugar for `s.html()` with a `tak:` prefix on the markup, mirroring
the existing `yt:` convention:

```ts
s.tak("<div style='display:flex'>…</div>", opts);
// equivalent to
s.html("tak:<div style='display:flex'>…</div>", opts);
```

- **`tak` never uses a browser.** That is the entire point.
- **`html` is unchanged** — Chrome or Obscura, full CSS, scripts if you want
  them.
- **One element type, no flag, no `auto`.** The prefix on the markup says which
  engine renders it, so `.add(html("tak:..."))` works outside a scene too.

The rule is one sentence: markup with `tak:` goes to Takumi; everything else
goes to a browser.

[Takumi](https://takumi.kane.tw/) is a Rust layout engine with text and inline
layout ported from Blink. It renders HTML/CSS/JSX to PNG, handles local fonts,
and takes SVG and PNG assets natively.

## Why a prefix

`yt:` already marks a source that needs a specific tool, and it works the same
way here: a marker on the input rather than a mode of the process. It also keeps
`html` exactly as it is, so nothing about existing compositions changes.

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
  second native dependency next to ffmpeg, so lazy-require it: a user who never
  writes `tak:` should not load it.

## Open questions

- **Strip the prefix before layout?** Yes — Takumi must see `<div>…`, not
  `tak:<div>…`. Follow `ytdlpUrl()`: a tiny `isTakumiMarkup()` / `takumiMarkup()`
  pair rather than an inline `slice()`.
- **Does it replace `shape`?** Takumi can draw rectangles and ellipses through
  CSS, but shapes need no layout engine and are cheaper. Shapes stay.
- **`deviceScaleFactor`?** Maps to Takumi's scale factor for crisp text, so the
  existing option should carry over.
- **What if the binding is missing?** Fail loudly with a hint, the way
  `yt-dlp` does when `yt:` is used and the tool is absent.

## Related

- `YTDLP_PREFIX` in `src/remote/ytdlp.ts` is the pattern being copied.
- Shapes (`013`) exist because agents were reaching for HTML to draw boxes.
- Obscura support landed in `1eda462`.
