# Composition Reference

The data shape behind everything: what `composition()` builds, what `render()`
takes, and what a `.kino` artifact carries.

> **This is the data shape, not the recommended authoring style.** Build
> compositions with the builder — you get types, loops and computed values. The
> object below is what comes out, and it is plain JSON-safe data, so writing it
> by hand still works. See [Getting Started](./getting-started.md) for the
> authoring side.

**Contents**

- [Shape of a composition](#shape-of-a-composition)
- [Scene](#scene)
- [Background](#background)
- [Transitions](#transitions)
- [Elements](#elements)
- [Compositing: blend, mask, motion blur](#compositing-blend-mask-motion-blur)
- [Colour grading](#colour-grading)
- [Animation](#animation)
- [Captions](#captions)
- [Templates](#templates)
- [Audio](#audio)

---

## Shape of a composition

```typescript
interface KinoComposition {
  width?: number | string;        // default 1920
  height?: number | string;       // default 1080
  fps?: number | string;          // default 30
  scenes: KinoScene[];            // required, at least one
  audio?: AudioTrack | AudioTrack[];
  templates?: KinoTemplate[];
  grade?: ColorAdjust;            // applied once to the finished frame
}
```

| Field | Default | Notes |
| --- | --- | --- |
| `width`, `height` | `1920`, `1080` | Pixels. Accept `"1920px"` too |
| `fps` | `30` | Accepts `"30fps"` |
| `scenes` | — | Required, non-empty |
| `audio` | — | One track or many |
| `templates` | `[]` | Reusable property bags |
| `grade` | — | See [Colour grading](#colour-grading) |

**The model in one paragraph.** A composition holds scenes. Scenes play in
order and own their background and timing. Elements are layers inside a scene,
positioned in frame coordinates and starting at `startAt` seconds relative to
their scene.

---

## Scene

```typescript
interface KinoScene {
  id?: string;
  duration: number | string | { fit: Voice };   // required
  background?: string | BackgroundConfig;
  elements?: ElementInput[];
  transition?: { type: KinoTransitionType; duration: number | string };
}
```

`duration` is seconds, or `{ fit: await voice("…") }` to size the scene to a
measured line of speech.

---

## Background

A scene background is a colour string or a config object:

```typescript
"#0f172a"                                                    // colour
{ type: "gradient", from: "#1e1b4b", to: "#000", direction: "vertical" }
{ type: "image", src: "./photo.jpg" }
{ type: "video", src: "./loop.mp4", loop: true }
```

| `type` | Fields |
| --- | --- |
| `color` | `value` |
| `gradient` | `from`, `to`, `direction` (`vertical` default, or `horizontal`) |
| `image` | `src` |
| `video` | `src`, `loop` |

---

## Transitions

A transition belongs to the **entering** scene and overlaps the two, so the
composition ends up shorter than the sum of its scenes. The first scene cannot
have one.

```typescript
{ duration: 2, transition: { type: "fade", duration: 0.5 } }
```

Types: `fade`, `slideLeft`, `slideRight`, `slideUp`, `slideDown`, `wipeLeft`,
`wipeRight`, `wipeUp`, `wipeDown`, `zoomIn`, `zoomOut`.

---

## Elements

Every element shares `BaseElement`:

```typescript
interface BaseElement {
  id?: string;
  x?: number | string;            // frame coordinates
  y?: number | string;
  offsetX?: number | string;
  offsetY?: number | string;
  startAt?: number | string;      // seconds from the scene's start
  duration?: number | string;
  zIndex?: number | string;
  sfx?: string | AudioTrack;
  animation?: ElementAnimation;
  grade?: ColorAdjust;
  blend?: BlendMode;
  mask?: ElementMask;
  motionBlur?: number | { samples?: number; shutter?: number };
}
```

`x` and `y` accept numbers, percentages, and shorthands like `"center"`,
`"bottom-140"`, `"top-10%"`.

### Text

```typescript
{
  type: "text",
  content: string,
  fontSize?, fontColor?, fontFile?,
  box?, boxColor?, boxPadding?,
  maxWidth?, textAlign?, lineHeight?,
  stroke?: { color, width },
  shadow?: { color, x?, y? },
  captionWords?: CaptionWord[],
  highlight?: string,
}
```

Builder options use `color` and `align`, which map to `fontColor` and
`textAlign`.

### Image

```typescript
{ type: "image", src, width?, height?, fit?, chromaKey? }
```

`fit` is `contain` (default), `cover`, `fill` or `none`. `chromaKey` is `true`
for green with defaults, or `{ color, similarity, blend, despill }`.

### Video

```typescript
{ type: "video", src, width?, height?, fit?, trimStart?, trimEnd?, loop?, volume?, chromaKey? }
```

`trimEnd` sets the duration when `duration` is unset, so
`{ trimStart: 2, trimEnd: 8 }` plays six seconds. `volume` mixes the clip's own
audio into the output.

### HTML

```typescript
{ type: "html", html, css?, width, height, fit?, backgroundColor?, deviceScaleFactor? }
```

`html` starting with `tak:` renders through Takumi instead of a browser. The
builder's `s.tak(markup, opts)` is sugar for that, so the marker travels with
the element.

### Shape

```typescript
{ type: "shape", shape: "rect" | "ellipse" | "line", width, height, fill?, stroke?, strokeWidth?, radius?, x1?, y1?, x2?, y2? }
```

Rasterised to a PNG at compile time — no browser. `radius` applies to `rect`;
`x1…y2` to `line`, relative to the shape's own box.

---

## Compositing: blend, mask, motion blur

These sit on `BaseElement`, so they work on text and shapes as well as media.

### `blend`

```typescript
type BlendMode =
  | "normal" | "multiply" | "screen" | "overlay" | "softlight" | "hardlight"
  | "difference" | "exclusion" | "darken" | "lighten" | "add";
```

`normal` is a plain alpha overlay. Any other mode composites the element
against what is already beneath it.

### `mask`

```typescript
interface ElementMask {
  shape?: "rect" | "ellipse" | "linear";
  src?: string;                                   // luma matte
  direction?: "up" | "down" | "left" | "right";   // for `linear`
  feather?: number;                               // pixels
  invert?: boolean;
}
```

Masks apply **after** the element is positioned, so their coordinates are frame
coordinates. `feather` blurs the mask, not the element.

### `motionBlur`

A sample count, or `{ samples, shutter }` where `shutter` is the open fraction
of a frame (`0.5` is the film-standard 180°). Off by default.

---

## Colour grading

The same object on an element or the composition:

```typescript
interface ColorAdjust {
  brightness?: number;      // -1..1
  contrast?: number;        // 0..3
  saturation?: number;      // 0..3
  hue?: number;             // degrees
  gamma?: number;           // 0.1..10
  lift?: number | [number, number, number];
  gain?: number | [number, number, number];
  lut?: string;             // .cube file or URL
  lutInterp?: "nearest" | "trilinear" | "tetrahedral" | "pyramid" | "prism";
  curves?: {
    master?: Array<[number, number]>;
    red?: Array<[number, number]>;
    green?: Array<[number, number]>;
    blue?: Array<[number, number]>;
  };
  balance?: {
    shadows?: [number, number, number];
    midtones?: [number, number, number];
    highlights?: [number, number, number];
    preserveLightness?: boolean;
  };
}
```

Filters are emitted in a fixed order: **LUT → curves → lift/gain → balance →
eq → hue**. The same numbers in a different order look different, so the order
is the contract.

---

## Animation

```typescript
interface ElementAnimation {
  opacity?: AnimatableValue;
  x?: AnimatableValue;
  y?: AnimatableValue;
  scale?: AnimatableValue;
}
```

`AnimatableValue` is either a two-point animation or a keyframe list:

```typescript
{ from: 0, to: 1, duration: 0.6, delay?: 0.2, easing?: "easeOut" }

{ keyframes: [
    { at: 0, value: 0.8, easing: "easeOutBack" },
    { at: 0.4, value: 1.1 },
    { at: 0.7, value: 1.0 },
  ],
  easing?: "easeInOut" }
```

`at` is seconds from the element's `startAt`. A keyframe's `easing` describes
the segment *arriving* at it, so the first one is unused.

### Easings

`linear`, `easeIn`, `easeOut`, `easeInOut` · `easeInSine`, `easeOutSine`,
`easeInOutSine` · `easeInExpo`, `easeOutExpo`, `easeInOutExpo` · `easeInCirc`,
`easeOutCirc`, `easeInOutCirc` · `easeInBack`, `easeOutBack`, `easeInOutBack` ·
`easeOutElastic`, `easeOutBounce`.

---

## Captions

```typescript
interface CaptionWord {
  word: string;
  at: number;        // seconds from the element's startAt
  duration: number;
}
```

When `captionWords` is set, the element draws `content` in `fontColor` and then
re-draws it clipped to each word, in `highlight`, while that word is spoken.

---

## Templates

A template is a named bag of element properties, with the element type it
applies to:

```typescript
interface KinoTemplate {
  id: string;
  type: "text" | "image" | "html" | "video";
  props: TemplateProps;   // the same fields an element accepts
}

templates: [{
  id: "title",
  type: "text",
  props: { fontSize: 96, fontColor: "#fff", x: "center", y: "center" },
}]
```

An element references one with `template: "title"` and must still set its own
`type`. Element properties win over template properties; `stroke` and `shadow`
replace wholesale rather than merging key by key. Shapes have no template type —
they were added after templates and take properties directly.

---

## Audio

```typescript
interface AudioTrack {
  src: string | TtsSpec;    // file, URL, `yt:` source, or tts() spec
  id?: string;              // names the track so another can duck under it
  startTime?: number | string;
  offset?: number | string;
  duration?: number | string;
  volume?: number | string;
  loop?: boolean;
  fadeIn?: number | string;
  fadeOut?: number | string;
  duck?: boolean | DuckConfig;
}
```

`duck: true` lowers the track whenever a speech track is audible. The object
form picks which tracks and how hard:

```typescript
{ src: "./music.mp3", id: "music", duck: { by: "voice", amount: 0.25, release: 0.4 } }
```

| `DuckConfig` | Default | Meaning |
| --- | --- | --- |
| `by` | every speech track | Track id, or an array of them |
| `amount` | `0.3` | Level to drop **to** |
| `release` | `0.4` | Seconds to ramp back up |
| `attack` | `0.02` | Seconds to ramp down |
| `threshold` | `0.02` | Sidechain level that counts as speech |
