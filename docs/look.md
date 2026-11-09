# Look

Grading, compositing and motion. These apply to any element — text and shapes
included — or to the whole composition.

## Colour

A grade can go on **any element** — to match one clip to the rest — or on the
**whole composition**, for a look that holds across the video:

```typescript
composition({ width: 1920, height: 1080, fps: 30, grade: { lut: "./looks/teal-orange.cube" } })

s.video("./clip.mp4", { grade: { lut: "./looks/log-to-rec709.cube" } });
```

The two compose: element grades run before the element is composited, the
composition grade runs once over the finished frame.

### The controls

```typescript
s.image("./clip.mp4", {
  grade: {
    lut: "./looks/film.cube",                    // .cube 3D LUT
    lutInterp: "tetrahedral",                    // or nearest, trilinear, pyramid, prism
    curves: {
      master: [[0, 0], [0.5, 0.62], [1, 1]],     // all channels
      blue: [[0, 0.05], [1, 0.95]],              // or one at a time
    },
    lift: [0.02, 0, -0.01],                      // per-channel black point
    gain: [1.05, 1.0, 0.95],                     // per-channel white point
    balance: {
      shadows: [0.05, 0, 0],                     // per-channel, -1..1
      midtones: [0, 0.02, 0],
      highlights: [0, 0, 0.05],
    },
    brightness: 0.05,
    contrast: 1.15,
    saturation: 1.2,
    gamma: 1.1,
    hue: -8,
  },
});
```

| Control | Range | Unchanged at | Effect |
| --- | --- | --- | --- |
| `lut` | `.cube` path or URL | — | A look, applied first |
| `curves` | points in 0..1 | identity | Tonal shaping, per channel |
| `lift` | −1…1 | `0` | Output black point |
| `gain` | 0…2 | `1` | Output white point |
| `balance` | −1…1 per channel | `0` | Shadows / midtones / highlights colour |
| `brightness` | −1…1 | `0` | Adds to every channel |
| `contrast` | 0…3 | `1` | Pivots around mid-grey |
| `saturation` | 0…3 | `1` | `0` is greyscale |
| `hue` | −180…180 | `0` | Degrees of rotation |
| `gamma` | 0.1…10 | `1` | Midtone response |

**Curve points** are `[input, output]` pairs. Missing endpoints are filled in, so
`[[0.5, 0.7]]` means "0 stays 0, 0.5 becomes 0.7, 1 stays 1".

**Order is fixed**, and the same for element and composition grades: LUT →
curves → lift/gain → balance → brightness/contrast/saturation/gamma → hue. The
same numbers in a different order look different, so the order is the contract.

Called `grade`, not `color`, because `color` already means font colour on text.
A neutral grade adds no filter at all.

:::preview name="feature-grade-curves" caption="curves — a contrast S-curve on a grey ramp"
:::

:::preview name="feature-grade-balance" caption="balance — teal shadows, orange highlights"
:::

### LUTs

Kino ships none — licensing a look is a trap. Where to get them:

- [FreshLUTs](https://freshluts.com/) and [IWLTBAP](https://iwltbap.com/) both
  have free packs
- DaVinci Resolve exports `.cube` files directly
- Any `.cube` works; kino reads only enough of the header to validate it

## Blending and masks

Two options on **every** element, not just images:

```typescript
s.image("./logo.png", {
  x: "center", y: "center",
  blend: "screen",                               // composite onto what's beneath
  mask: { shape: "ellipse", feather: 20 },       // or a matte from a file
});

s.text("Long paragraph…", {
  mask: { shape: "linear", direction: "down" },  // fade out towards the bottom
});

s.image("./photo.jpg", { mask: { src: "./gradient.png" } });  // luma matte
```

**Blend modes**

| | | |
| --- | --- | --- |
| `normal` (default) | `multiply` | `screen` |
| `overlay` | `softlight` | `hardlight` |
| `difference` | `exclusion` | `darken` |
| `lighten` | `add` | |

**Masks**

| Option | Description |
| --- | --- |
| `shape` | `rect`, `ellipse`, or `linear` (a gradient across the frame) |
| `direction` | For `linear`: `up`, `down` (default), `left`, `right` |
| `src` | A file whose **luma** becomes the element's alpha |
| `feather` | Pixels to soften the edge. Blurs the mask, not the element |
| `invert` | Swap inside and outside |

Masks are applied **after** the element is positioned, so their coordinates are
frame coordinates: a `linear` mask fades the bottom of the frame wherever the
element sits.

> **Cost.** A blended or masked element is a subgraph, not a single overlay —
> it is laid onto a transparent full-frame canvas first, because ffmpeg's
> `blend` requires both inputs to be the same size. Sequential passes are
> linear in the number of such elements. Elements without either option keep
> the fast single-pass path.

:::preview name="feature-blend" caption="screen and multiply"
:::

:::preview name="feature-mask" caption="an ellipse mask and a linear gradient"
:::

## Animation

| Helper | Produces |
| --- | --- |
| `animate({ from, to, duration, easing })` | Arbitrary value animation |
| `fadeIn(duration?, easing?)` | `opacity` 0 → 1 |
| `fadeOut(duration?, easing?)` | `opacity` 1 → 0 |
| `slideIn("x" \| "y", distance, duration?, easing?)` | Position offset → 0 |
| `popIn(duration?, easing?)` | `scale` 0.8 → 1 |

### Keyframes

For anything with more than one beat, give a channel a keyframe list:

```typescript
s.text("Title", {
  animation: {
    scale: {
      keyframes: [
        { at: 0, value: 0.8, easing: "easeOutBack" },
        { at: 0.4, value: 1.1 },
        { at: 0.7, value: 1.0 },
      ],
    },
  },
});
```

`at` is seconds from the element's `startAt`. `easing` on a keyframe describes
the segment *arriving* at it, so the first one is unused and the last applies on
the way in. Omit it to inherit the track's `easing`, defaulting to `easeInOut`.

`{ from, to, duration }` is sugar for two keyframes.

**Easings**

| | |
| --- | --- |
| `linear`, `easeIn`, `easeOut`, `easeInOut` | Basic polynomial |
| `easeInSine`, `easeOutSine`, `easeInOutSine` | Gentle |
| `easeInExpo`, `easeOutExpo`, `easeInOutExpo` | Sharp |
| `easeInCirc`, `easeOutCirc`, `easeInOutCirc` | Curved |
| `easeInBack`, `easeOutBack`, `easeInOutBack` | Wind up / overshoot, then settle |
| `easeOutElastic` | Springy oscillation |
| `easeOutBounce` | Bounces into place |

The overshooting curves intentionally pass the end value before settling.

:::preview name="feature-keyframes" caption="keyframes — overshoot, settle, and a bounce"
:::

## Motion blur

Fast movement looks mechanical without it. Any element can be blurred the way a
camera would:

```typescript
s.text("Title", {
  animation: { x: { from: -400, to: 0, duration: 0.6 } },
  motionBlur: 8,                                   // 8 samples, 180° shutter
});

s.image("./logo.png", {
  animation: { scale: { from: 0.6, to: 1, duration: 0.4 } },
  motionBlur: { samples: 8, shutter: 0.25 },       // a shorter exposure
});
```

| Value | Meaning |
| --- | --- |
| `4` | A good default when it is on |
| `8` | Smooth |
| `16` | Diminishing returns, 16× the cost for that element |
| `{ samples, shutter }` | `shutter` is the fraction of a frame the shutter is open, 0–1. `0.5` is the film-standard 180° |

Off by default, and only worth turning on for elements that actually move — a
stationary element costs the same and looks identical.

> **Cost.** Blur samples the element's own layer, not the frame, so the extra
> work scales with the number of blurred elements rather than the composition.
> A blurred element also fades in over its first few frames, because the running
> average needs that many frames to fill.

:::preview name="feature-motion-blur" caption="motionBlur: 8 on a fast-moving block"
:::

## Transitions

Set on the scene that is arriving:

```typescript
.scene({ duration: 3, transition: "fade" }, …)                       // 0.5s default
.scene({ duration: 3, transition: { type: "slideLeft", duration: 1 } }, …)
```

A transition overlaps the two scenes, so the composition is shorter than the sum
of its scene durations. The first scene cannot have one.

**Supported types**

| | | |
| --- | --- | --- |
| `fade` | `slideLeft` | `slideRight` |
| `slideUp` | `slideDown` | `wipeLeft` |
| `wipeRight` | `wipeUp` | `wipeDown` |
| `zoomIn` | `zoomOut` | |

## Option aliases

Builder options mirror the composition fields with friendlier names:

| Builder option | Composition field |
| --- | --- |
| `color` | `fontColor` |
| `align` | `textAlign` |

Unset options are omitted entirely, so the emitted object is clean, JSON-safe
data.

---
---

Next: [Sound](./sound.md) covers narration, music and ducking.
