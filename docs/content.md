# Content

Everything that can sit inside a scene: text, images, video, shapes, HTML and
captions. Each is a method on the scene builder and returns the element, so calls
chain.

## Text

```typescript
s.text("Title", {
  fontSize: 72,
  color: "#fff",
  x: "center",              // or "left", "right", "50%", "bottom-240"
  y: "center",
  maxWidth: 900,            // wraps
  align: "center",
  lineHeight: 1.2,
  stroke: { color: "#000", width: 2 },
  shadow: { color: "#000", x: 2, y: 2 },
});
```

`x` and `y` accept numbers, percentages, and shorthands like `bottom-240` or
`top-10%`.

## Images and video

```typescript
s.image("./photo.jpg", { width: 800, x: "center", y: "center", fit: "cover" });
s.video("./clip.mp4", { width: 1920, height: 1080, trimStart: 2, trimEnd: 8 });
```

`yt:` sources are fetched with `yt-dlp`, which must be on `PATH`:

```typescript
s.video("yt:https://youtube.com/watch?v=…", { width: 1280 });
```

Green-screen footage can be keyed:

```typescript
s.video("./greenscreen.mp4", { chromaKey: true });            // key green
s.image("./logo.png", { chromaKey: { color: "#00ff00", similarity: 0.1 } });
```

## Shapes

Rectangles, ellipses and lines, drawn to a PNG at compile time — no browser:

:::preview name="feature-shapes" caption="rect, ellipse and line — no browser"
:::

```typescript
import { rect, ellipse, line } from "@glitchoff/kino";

s.add(rect({ width: 400, height: 120, x: 80, y: 80, fill: "#38bdf8", radius: 24 }));
s.add(ellipse({ width: 200, height: 200, x: 80, y: 260, fill: "transparent", stroke: "#fff", strokeWidth: 4 }));
s.add(line({ width: 400, height: 200, x: 80, y: 520, x1: 0, y1: 0, x2: 400, y2: 200, stroke: "#f472b6", strokeWidth: 6 }));
```

| Option | Applies to | Description |
| --- | --- | --- |
| `width`, `height` | all | The shape's box. Required, must be positive |
| `fill` | all | Interior colour. `"transparent"` for an outline only |
| `stroke`, `strokeWidth` | all | Border colour and thickness |
| `radius` | `rect` | Corner radius, clamped to half the shorter side |
| `x1`, `y1`, `x2`, `y2` | `line` | End points, relative to the shape's own box |

A shape with neither fill nor stroke is rejected rather than drawing nothing.

When the kind is data rather than literal — a list of callouts, say — `shape()`
takes it as an argument:

```typescript
import { shape } from "@glitchoff/kino";

const kinds = ["rect", "ellipse", "line"] as const;
kinds.forEach((kind, i) => {
  s.add(shape(kind, { width: 120, height: 80, x: 40 + i * 140, y: 60, fill: "#38bdf8" }));
});
```

## HTML

Two engines, same element type. `s.html()` uses a browser; `s.tak()` does not.

```typescript
s.html("<div class='card'>…</div>", { width: 600, height: 300 });  // Chrome or Obscura
s.tak("<div class='card'>…</div>", { width: 600, height: 300 });   // Takumi, no browser
```

`s.tak()` is sugar for `s.html("tak:" + markup, options)`, so the marker travels
with the markup — `html("tak:…")` works through `.add()` too.

:::preview name="feature-takumi" caption="s.tak() — HTML with no browser"
:::

**Prefer `tak` unless you need something only a browser can do.**

| | `s.html()` | `s.tak()` |
| --- | --- | --- |
| Engine | Chrome or Obscura | Takumi (Rust) |
| Needs a browser | yes | **no** |
| Scripts | yes | no |
| CSS coverage | complete | Flexbox/Grid/block/inline/table/float |
| Same output everywhere | no (Chrome vs Obscura differ) | yes |

Takumi supports Flexbox, Grid, block, inline, table and float layout, gradients,
masks, filters, blend modes, `@keyframes` and Tailwind utilities, and reads local
fonts, SVG and PNG. It never reads system fonts, so kino passes its bundled
Inter explicitly — text renders with no setup.

## Captions

Two renderers, one pipeline. `captionElements` draws with ffmpeg's `drawtext`;
`captionImages` rasterises each word state to a PNG.

```typescript
import { captionElements, captionImages } from "@glitchoff/kino";

// drawtext: crisp and cheap, but stalls past a handful of lines
s.addAll(captionElements(timings, { style: "karaoke", fontSize: 56 }));

// rasterised: scales to a whole song
s.addAll(await captionImages(timings, {
  width: 3840, height: 216, displayWidth: 1920, displayHeight: 108,
  dir: "./.captions", wordsPerLine: 6,
}));
```

| Style | What it does |
| --- | --- |
| `karaoke` | One line, the sung word highlighted |
| `reveal` | Words appear one at a time and stay |
| `word` | One word on screen at a time |
| `block` | Static subtitle blocks |

Pass **every** word timing in one call. Line holds are trimmed against the next
line, which only works when all lines are built together — calling per line
stacks captions on screen.

Word-level alignment to real audio is optional and cache-based; see
`captionsAsync`.

### Presets

A style says *how words appear*; a preset says *what they look like*. Presets
bundle both, because a recognisable caption look is the whole package — Anton
with a hairline stroke is a different thing from Inter with a fat one.

```typescript
s.addAll(captions(line, { preset: "shout" }));

// Anything passed explicitly wins over the preset.
s.addAll(captions(line, { preset: "shout", fontSize: 120 }));

// `text` merges one level deep, so this adds a shadow and keeps the stroke.
s.addAll(captions(line, { preset: "shout", text: { shadow: { color: "#000", x: 2, y: 2 } } }));
```

| Preset | Look | Font |
| --- | --- | --- |
| `shout` | All caps, thick black stroke, centred on the art, one word at a time | Anton |
| `shout-band` | The same face as a bottom-band line with a karaoke sweep | Anton |
| `plain` | Conventional subtitles: sentence case, thin outline, bottom-centre | Inter |

:::preview name="feature-caption-preset" caption="preset: shout"
:::

### GPU text (opt-in)

`drawtext` is ffmpeg's text filter, and each karaoke word costs it about four
filters — a `split`, a `crop` to the word box, a second `drawtext` in the
highlight colour, and an `overlay` to paste it back. That is fine for a handful
of lines and it is **not** fine for a chapter: a 100-line track emits thousands
of filters in one serial chain, and the render stalls on the text rather than on
the encoder.

`render: "gpu"` swaps that for a glyph atlas. Text is laid out with
cosmic-text, each glyph is rasterised once, and every word becomes a quad — so
word count stops mattering.

```typescript
// Opt in per call.
s.addAll(captions(line, { preset: "shout-band", render: "gpu" }));
```

It is **off by default and never switches on its own**. Three ways to enable it:

```typescript
// 1. per caption call
captions(line, { render: "gpu" })

// 2. every caption in a render
await render(comp, { output: "out.mp4", gpuText: true })

// 3. a cap: only tracks longer than N lines take the GPU path
await render(comp, { output: "out.mp4", gpuText: 20 })
```

A caption's own `render` wins over the render options. `render: "auto"` picks
`gpu` when the track exceeds `gpuTextThreshold` (default 20 lines) and
`drawtext` otherwise.

**Requires the `gpucap` binary** on `PATH`, or `gpuTextPath` pointing at it. It
is not a dependency of kino; without it, `render: "gpu"` falls back to
`drawtext` and logs once.

**What stays on `drawtext`:** a stroke. The GPU path currently draws fill only,
so white text over a pale panel has no outline. If a caption needs a stroke
today, leave it on `drawtext`.


:::preview name="feature-caption-shout-band" caption="preset: shout-band"
:::

:::preview name="feature-caption-plain" caption="preset: plain"
:::

The four built-in styles, for comparison:

:::preview name="feature-caption-karaoke" caption="style: karaoke"
:::

:::preview name="feature-caption-reveal" caption="style: reveal"
:::

:::preview name="feature-caption-word" caption="style: word"
:::

An unknown preset name **throws** rather than falling back to the default style,
so a typo like `"shoutt"` cannot quietly render something else.

#### Fitting is automatic

A preset measures itself against the frame and fits, so you do not size text by
hand:

- **It wraps** to `widthRatio` of the frame width (default `0.9`).
- **It shrinks** when a single word is still too wide, because a word cannot be
  wrapped and clipped text is worse than small text.

Both use the font's real advance table, not a character-class estimate. That
distinction is not pedantry: the estimate prices every lowercase letter at
`0.52em`, where Anton runs closer to `0.38em`, so a line it reports as fitting
is visibly cut off at both edges.

Override the margin with `widthRatio`, or pin an exact width with `maxWidth`:

```typescript
captions(line, { preset: "plain", widthRatio: 0.8 });
```

### How `word` timing works

`style: "word"` shows one word at a time. Each word holds **until the next word
starts**, not until its own speech ends. Both simpler rules fail:

- *its own duration only* — the frame goes blank during a pause, and the final
  word disappears before the audio does;
- *its own duration plus `hold`* — two words are on screen at once, and since
  every element is centred at the same point they draw as stacked glyphs.

Holding to the next start means exactly one word is always visible. The last
word gets the trailing `hold`.

:::preview name="feature-captions" caption="karaoke captions"
:::

---
---

Next: [Look](./look.md) covers how that content is graded, blended and animated.
