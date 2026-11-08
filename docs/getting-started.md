# Getting Started with Kino

Kino lets you write video compositions in TypeScript and compile them to MP4 via
FFmpeg. A composition is plain data: build it with the `composition()` builder,
as a typed object literal, or — for compatibility — as JSON.

> **JSON is legacy.** New projects should use code compositions. JSON input is
> still accepted everywhere, but it is frozen: new features land in the builder
> first. See [Compositions](#compositions).

**Contents**

- [Installation](#installation) — including optional pieces you can skip
- [Your first video](#your-first-video)
- [Compositions](#compositions) — scenes, elements, reuse
- [Content](#content) — text, images, video, HTML, shapes
- [Look](#look) — colour, animation, transitions
- [Sound](#sound) — narration and ducking
- [Checking your work](#checking-your-work) — before you render
- [Rendering](#rendering) — the CLI, previews, dry runs
- [Kino Studio](#kino-studio)

---

## Installation

```bash
pnpm add @glitchoff/kino   # or: npm install @glitchoff/kino
```

FFmpeg is resolved automatically: Kino ships a vendored Linux build that
includes `drawtext`, and falls back to `ffmpeg-static` elsewhere. Point it
somewhere else with `--ffmpeg-path`.

### Optional pieces

Nothing below is required. Each unlocks one feature.

| Feature | Needs | Setup |
| --- | --- | --- |
| `s.html()` | Chrome or Chromium | `npx puppeteer browsers install chrome` |
| `s.html()` without a browser | nothing extra | already installed with kino (`takumi-js`) |
| `s.tak()` | nothing | built in |
| Narration (`tts()`, `s.say()`) | [Piper](https://github.com/OHF-Voice/piper1-gpl) on `PATH` | see [Sound](#sound) |
| `yt:` sources | `yt-dlp` on `PATH` | see [Images and video](#images-and-video) |
| Word-level caption alignment | an aligner | see [Captions](#captions) |

Using Obscura instead of Chrome is covered in [Rendering](#rendering).

---

## Your first video

```typescript
import { composition, fadeIn, render } from "@glitchoff/kino";

const video = composition({ width: 1920, height: 1080, fps: 30 })
  .scene({ duration: 5, background: "#0f172a" }, (scene) =>
    scene.text("Welcome to Kino", {
      fontSize: 64,
      color: "#38bdf8",
      x: "center",
      y: "center",
      animation: { opacity: fadeIn(0.6) },
    })
  )
  .build();

await render(video, { output: "./welcome.mp4" });
```

The same file works from the CLI as `npx kino welcome.ts -o out.mp4`, as long as
it has a default export.

---

## Compositions

### The builder

```typescript
import { composition } from "@glitchoff/kino";

const video = composition({ width: 1080, height: 1920 })
  .scene({ duration: 5, background: "#0f172a" }, (s) =>
    s
      .text("The Blue Marble", { fontSize: 84, color: "#fff", x: "center", y: "(h-text_h)/2-400" })
      .image("./earth.jpg", { width: 640, x: "center", startAt: 2 })
  )
  // A transition belongs to the scene arriving, so the first scene cannot have
  // one — hence the separate second scene here.
  .scene({ duration: 4, background: "#111827", transition: { type: "fade", duration: 0.6 } }, (s) =>
    s.text("Fin.", { fontSize: 72, color: "#94a3b8", x: "center", y: "center" })
  )
  .build();
```

| Call | Purpose |
| --- | --- |
| `composition({ width, height, fps, audio, templates })` | Start a composition |
| `.scene({ id, duration, background, transition }, cb?)` | Add a scene |
| `.addScene(scene)` / `.addScenes(scenes)` | Append raw scene objects |
| `.audio(tracks)` / `.template(t)` | Composition-level settings |
| `.build()` | Produce a `KinoComposition` |

Inside a scene callback: `.text()`, `.image()`, `.video()`, `.html()`, `.tak()`,
`.add()`, `.addAll()`.

### Standalone element helpers

Useful with `map`/`filter` when the content is generated:

```typescript
import { composition, text } from "@glitchoff/kino";

const titles = ["One", "Two", "Three"];

composition({ width: 1080, height: 1920 })
  .scene({ duration: 3 * titles.length, background: "#000" }, (s) =>
    s.addAll(
      titles.map((title, i) =>
        text(title, { fontSize: 96, color: "#fff", x: "center", y: "center", startAt: i * 3, duration: 3 })
      )
    )
  );
```

### Reusable components

A component is a function or a `SceneBuilder` — there is no separate component
model. Four patterns cover most reuse:

```typescript
import { composition, text, withDefaults, SceneBuilder } from "@glitchoff/kino";

// 1. A derived factory: define the look once, override per use.
const Title = withDefaults(text, {
  fontSize: 96, color: "#fff", x: "center", y: "center",
});
Title("Hello");                          // defaults
Title("Hello", { color: "#38bdf8" });    // per-call options win

// 2. A scene callback: same scene, different data.
const titleCard = (heading: string) => (s: SceneBuilder) => s.add(Title(heading));

// 3. A pre-built scene: `.scene()` accepts a KinoScene or SceneBuilder directly.
const lowerThird = (name: string) =>
  new SceneBuilder({ duration: 3 }).text(name, { x: 80, y: "bottom-140" });

composition({ width: 1080, height: 1920 })
  .scene({ duration: 3 }, titleCard("Intro"))
  .scene({ duration: 2 }, titleCard("Outro"))
  .scene(lowerThird("Alice").build());

// 4. A generator: one scene per item.
function* credits(names: string[]) {
  for (const name of names) yield (s: SceneBuilder) => s.text(name, { y: "center" });
}
```

`withDefaults` merges one level deep — passing `stroke` replaces a default
`stroke` entirely rather than merging its keys. Defaults are never mutated, so
the same derived factory can be reused freely.

See `examples/reusable-components.ts` for a runnable version.

### Plain objects

Everything the builder produces is a plain `KinoComposition`, so object literals
work anywhere a builder does. This is the same video written directly:

```typescript
import { render } from "@glitchoff/kino";

await render(
  {
    width: 1080, height: 1080, fps: 30,
    scenes: [{
      duration: 3,
      background: "#111",
      elements: [{ type: "text", content: "Hi", fontSize: 72, x: "center", y: "center" }],
    }],
  },
  { output: "out.mp4" }
);
```

---

## Content

### Text

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

### Images and video

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

### Shapes

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

### HTML

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

### Captions

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

:::preview name="feature-captions" caption="karaoke captions"
:::

---

## Look

### Colour

A grade can go on **any element** — to match one clip to the rest — or on the
**whole composition**, for a look that holds across the video:

```typescript
composition({ width: 1920, height: 1080, fps: 30, grade: { lut: "./looks/teal-orange.cube" } })

s.video("./clip.mp4", { grade: { lut: "./looks/log-to-rec709.cube" } });
```

The two compose: element grades run before the element is composited, the
composition grade runs once over the finished frame.

#### The controls

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

#### LUTs

Kino ships none — licensing a look is a trap. Where to get them:

- [FreshLUTs](https://freshluts.com/) and [IWLTBAP](https://iwltbap.com/) both
  have free packs
- DaVinci Resolve exports `.cube` files directly
- Any `.cube` works; kino reads only enough of the header to validate it

### Blending and masks

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

### Animation

| Helper | Produces |
| --- | --- |
| `animate({ from, to, duration, easing })` | Arbitrary value animation |
| `fadeIn(duration?, easing?)` | `opacity` 0 → 1 |
| `fadeOut(duration?, easing?)` | `opacity` 1 → 0 |
| `slideIn("x" \| "y", distance, duration?, easing?)` | Position offset → 0 |
| `popIn(duration?, easing?)` | `scale` 0.8 → 1 |

#### Keyframes

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

### Motion blur

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

### Transitions

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

### Option aliases

Builder options mirror the composition fields with friendlier names:

| Builder option | Composition field |
| --- | --- |
| `color` | `fontColor` |
| `align` | `textAlign` |

Unset options are omitted entirely, so the emitted object is clean, JSON-safe
data.

---

## Sound

### Narration

Speech is generated locally with [Piper](https://github.com/OHF-Voice/piper1-gpl).
Piper is **external and optional** — kino spawns the `piper` binary and never
bundles it (its engine is GPL-3.0; the subprocess boundary keeps that out of
this package).

```bash
# one-time, outside the project
pip install piper-tts
```

```typescript
// Per scene: the scene can size itself to the speech.
.scene({ duration: { fit: await voice("Already measured") } }, (s) => {
  s.say("Already measured");
})

// Or measure first and place the scene yourself.
s.say("नमस्ते, welcome to Kino", { voice: "hi_IN-rohan" });
```

`voice()` synthesises once and returns a handle, so a line can be measured and
reused without synthesising twice.

### Music and ducking

```typescript
composition().audio([
  { src: "./music.mp3", id: "music", volume: 0.6, loop: true, duck: true },
  { src: "./voice.wav", id: "voice" },
]);
```

`duck: true` lowers the music whenever a speech track — anything from `tts()` or
`s.say()` — is audible. Name tracks explicitly to control it:

```typescript
{ src: "./music.mp3", id: "music", duck: { by: "voice", amount: 0.25 } }
```

| `DuckConfig` | Default | Description |
| --- | --- | --- |
| `by` | every speech track | Track id, or an array of them |
| `amount` | `0.3` | Level to drop **to**, so `0.3` means 30% |
| `release` | `0.4` | Seconds to ramp back up. Longer stops it pumping |
| `attack` | `0.02` | Seconds to ramp down |
| `threshold` | `0.02` | Sidechain level that counts as speech |

It follows the real speech envelope, so it needs no word timings. `amount` is a
target, not a guarantee — the achieved depth depends on how loud the speech is.

| Audio track field | Description |
| --- | --- |
| `src` | File, URL, `yt:` source, or `tts()` spec |
| `id` | Names the track so another can duck under it |
| `startTime` / `offset` / `duration` | Position and trim |
| `volume` / `loop` / `fadeIn` / `fadeOut` | Level and shape |
| `duck` | Drop under speech |

---

## Checking your work

### `inspect()` — describe it without rendering

```typescript
import { inspect } from "@glitchoff/kino";

const report = inspect(comp);

for (const issue of report.issues) {
  console.log(`[${issue.severity}] ${issue.code}: ${issue.message}`);
}
// [error] text-wider-than-frame: Text is 2116px wide, wider than the 640px frame.
// [warning] element-outlives-scene: Element ends 1.50s after scene 'scene-1' and will be cut off.
// [error] missing-source: Source not found: ./missing.png
```

Synchronous, and starts nothing — no ffmpeg, no browser. Each element reports a
resolved `box` in frame pixels plus the `position` you wrote. Text width is read
from the font's advance tables, which is the number drawtext uses, so the boxes
match the render.

Issues: `text-wider-than-frame`, `text-outside-frame`, `element-outside-frame`,
`element-outlives-scene`, `element-overlap`, `missing-source`,
`transition-longer-than-scene`, `invalid-composition`.

### `measureText()` — exact text width

```typescript
const { width, source } = measureText("Maybe", { fontSize: 64 });
// { width: 202.9, source: "font" }
```

Synchronous, exact, and cheap. `source` is `"font"` when read from the file, or
`"estimate"` when the font could not be loaded and it fell back to the
character-class estimator — which is visibly wrong: on `"WWWW"` at 64px it says
205px where the real advance is 250px.

### `Preview` — scrub without rendering

```typescript
import { Preview } from "@glitchoff/kino";

const preview = await Preview.open(comp, { height: 360 });
const frame = await preview.frame(3.2);
frame.url;   // data:image/png;base64,… — straight into an <img>
preview.close();
```

Compiles once and renders a small proxy, so each frame costs ~30 ms instead of
~200 ms. The proxy is deliberately small and lossy — for judging layout and
timing, not colour.

:::preview name="feature-preview-api" caption="Preview.open() — scrubbing a composition"
:::

---

## Rendering

### The CLI

```bash
npx kino composition.ts -o out.mp4
npx kino composition.ts --dry-run          # print the ffmpeg command
npx kino composition.ts --preview          # fast 144p render
npx kino composition.ts --crf 18           # higher quality (default 20)
npx kino composition.ts --scene 2          # one scene only
npx kino out.kino -o out.mp4               # a pre-compiled artifact
```

| Flag | Purpose |
| --- | --- |
| `-o, --output <path>` | Where the video goes |
| `--dry-run` | Print the ffmpeg command and exit |
| `--preview [height]` | Fast downscaled render |
| `--crf <n>` | Encoder quality, 0–51, lower is better. Default 20 |
| `--preset <name>` | Encoder preset (x264, NVENC p1–p7, …) |
| `--scene <n>` | Render one scene |
| `--ffmpeg-path <path>` | Override the ffmpeg binary |
| `--browser <engine>` | `chrome`, `obscura`, or `auto` for `html` elements |
| `--browser-url <url>` | CDP endpoint for Obscura |
| `--asset-cache [dir]` | Cache downloaded assets |
| `--ytdlp` | Allow `yt:` sources |
| `--verbose` | Show the ffmpeg command and its output |

### From code

```typescript
import { render, exportComposition } from "@glitchoff/kino";

await render(comp, { output: "out.mp4" });

// Or take what you need — each output is independent
const { frames, video, preview } = await exportComposition(comp, {
  frames: [0, 1.5, { at: 3, name: "title" }],
  video: "out.mp4",
  preview: 144,
});
```

Stills are cheap — a frame costs a seek, not a render. Each comes back as
`{ at, path, data }` with `data` a `data:image/png;base64,…` URL.

### Hardware acceleration

`encoder: "auto"` probes the machine and picks the best available GPU encoder
(NVENC, QSV, AMF, VideoToolbox, VAAPI), falling back to `libx264`.

### Browsers for `html` elements

| `--browser` | Behaviour |
| --- | --- |
| `chrome` (default) | Chrome or Chromium via Puppeteer |
| `obscura` | Connect to a running [Obscura](https://docs.obscura.sh/) over CDP |
| `auto` | Obscura when one is reachable, Chrome otherwise |

`npx kino setup obscura` installs one locally. Obscura speaks the Chrome DevTools
Protocol, so the page code is unchanged; kino connects and disconnects rather
than launching, so a render never kills your instance.

Remember that `s.tak()` needs none of this.

---

## Kino Studio

A local web studio with an editor and a render preview player:

```bash
pnpm studio        # http://localhost:5173
```

See [studio.md](./studio.md).
