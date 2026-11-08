# Getting Started with Kino

Kino lets you write video compositions in TypeScript (or JavaScript) and compile them to MP4 via FFmpeg. A composition is plain data, so you can build it with the `composition()` builder, as a typed object literal, or — for compatibility — as JSON.

> **JSON is legacy.** New projects should use code compositions. JSON input is
> still accepted everywhere and is not going away, but it is frozen: new features
> land in the builder first, and JSON files only get what maps onto the
> `KinoComposition` shape. See [Code Compositions](#-code-compositions).

---

## 📦 Installation

Add `@glitchoff/kino` to your Node.js or TypeScript project:

```bash
# Using pnpm
pnpm add @glitchoff/kino

# Using npm
npm install @glitchoff/kino
```

### Optional HTML Element Setup

Puppeteer and Chromium are only needed when a composition contains an `html` element. Standard Kino compositions do not need a browser, and **no browser is downloaded at install time** — installing the package never downloads Chromium. Instead, Kino downloads Chrome lazily, the first time a composition with an `html` element is compiled:

- **Automatic (default):** compile a composition that contains an `html` element. Kino detects that no browser is available, downloads Chrome into the shared cache (`~/.cache/puppeteer`) once, and continues.
- **Explicit (pre-install ahead of time):**

  ```bash
  npx kino setup
  # or, explicitly
  npx kino setup browser
  ```

  Re-running `setup` is a no-op once Chrome is installed.

If you already have Chrome or Chromium installed, skip the download entirely and point Kino at it with `--browser-path`. When `--browser-path` is provided, Kino uses that executable directly and **never downloads a browser**:

```bash
npx kino examples/showcase.ts -o html-showcase.mp4 \
  --browser-path "C:\Program Files\Google\Chrome\Application\chrome.exe"
```

The browser is needed only while compiling HTML into the `.kino` artifact. Once compiled, the artifact contains the rasterized PNG and can render without a browser.

#### Using Obscura instead of Chrome

[Obscura](https://docs.obscura.sh/) is a headless browser engine written in Rust that speaks the Chrome DevTools Protocol. It starts instantly and uses far less memory than Chrome, and — being a single static binary — it does not need Chrome's library chain (`libatk`, `libnss`, and friends) to be present.

Start it, then ask Kino to connect to it:

```bash
npx kino setup obscura      # downloads it once into ~/.cache/kino/obscura
obscura serve --port 9222

npx kino examples/showcase.ts -o html-showcase.mp4 --browser obscura
```

Kino connects over CDP rather than launching a binary, so the rendering code is identical either way. The endpoint defaults to `http://127.0.0.1:9222`; override it with `--browser-url` or `OBSCURA_URL`.

Use `--browser auto` to prefer Obscura when one is reachable and fall back to Chrome when it is not. The default stays `chrome`, so existing setups are unaffected.

> **Note:** Kino includes a built-in FFmpeg binary fallback on every platform, so manual installation of an FFmpeg binary is optional. Windows and macOS use `ffmpeg-static`; Linux ships a pinned drawtext-enabled build (ffmpeg-static's Linux binary predates the FFmpeg 6.1 `libharfbuzz` requirement, so text would otherwise fail silently). Both are installed automatically at package install. To install or verify them manually:

> ```bash
> npx kino setup ffmpeg
> ```

> **Note:** Text elements use **Inter Regular** by default (bundled in the package). For custom fonts, set `fontFile` on the element.
>
> > **Linux / Docker / container environments:** If `npm install` fails with `EXDEV: cross-device link` during the FFmpeg postinstall step, `/tmp` (tmpfs) and the project directory are on different filesystems. Workaround: `TMPDIR=/path/to/project/.tmp npm install` (ensure the TMPDIR path is on the same filesystem as the project). The bundled FFmpeg binary will be extracted to `node_modules/@glitchoff/kino/vendor/linux/<arch>/ffmpeg`.

---

## 🚀 Programmatic Quickstart

Create a TypeScript or JavaScript file (e.g., `index.ts`):

```typescript
import { composition, fadeIn, render } from "@glitchoff/kino";

// 1. Describe the video. The builder returns a plain KinoComposition object,
//    so you get types, loops and computed values without a schema.
const video = composition({ width: 1920, height: 1080, fps: 30 })
  .scene({ duration: 5, background: "#0f172a" }, (scene) =>
    scene.text("Welcome to Kino", {
      fontSize: 64,
      color: "#38bdf8",
      x: "center",
      y: "center",
      startAt: 0,
      duration: 5,
      animation: { opacity: fadeIn(0.6) },
    })
  )
  .build();

// 2. Render directly to MP4 with automatic hardware acceleration
async function run() {
  console.log("Rendering video...");
  const result = await render(video, {
    output: "./welcome.mp4",
    encoder: "auto", // probes the machine and picks the best available GPU encoder
    verbose: true
  });
  console.log(`Video rendered successfully to ${result.output}`);
}

run();
```

The same file works as a CLI input — `npx kino welcome.ts -o out.mp4` — as long as
it has a default export. See [Code compositions](#-code-compositions) below.

---

## 🧩 Code Compositions

A composition is just data. You can write it as JSON, as a plain object, or with
the builder — all three produce the same `KinoComposition`, and every entry point
accepts any of them.

### The builder

```typescript
import { composition, image, text, fadeIn } from "@glitchoff/kino";

const video = composition({ width: 1080, height: 1920 })
  .scene({ duration: 8, background: "#0f172a", transition: "fade" }, (s) =>
    s
      .text("The Blue Marble", { fontSize: 84, color: "#fff", x: "center", y: "(h-text_h)/2-400" })
      .image("https://example.com/earth.jpg", { width: 640, x: "center", startAt: 2 })
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

Inside a scene callback: `.text()`, `.image()`, `.video()`, `.html()`, `.add()`,
`.addAll()`.

### HTML without a browser

`s.html()` renders through Chrome or Obscura — a real browser, one page render
per element. `s.tak()` renders the same markup with
[Takumi](https://takumi.kane.tw/), a Rust layout engine: no browser, and the
same output on every machine.

```typescript
s.html("<div class='card'>…</div>", { width: 600, height: 300 });  // browser
s.tak("<div class='card'>…</div>", { width: 600, height: 300 });   // Takumi
```

`s.tak()` is sugar for `s.html("tak:" + markup, options)`, so the marker travels
with the markup — `html("tak:…")` also works through `.add()`.

**Use `tak` unless you need something only a browser can do.** Takumi supports
Flexbox, Grid, block, inline, table and float layout, gradients, masks, filters,
blend modes, `@keyframes` and Tailwind utilities, and it reads local fonts, SVG
and PNG. It does **not** run scripts, and it supports less CSS than Chrome.

| | `s.html()` | `s.tak()` |
| --- | --- | --- |
| Engine | Chrome or Obscura | Takumi (Rust) |
| Needs a browser | yes | **no** |
| Scripts | yes | no |
| CSS coverage | complete | Flexbox/Grid/block/inline/table/float |
| Same output everywhere | no (Chrome vs Obscura differ) | yes |

Fonts are passed explicitly — kino ships Inter, so text renders without any
setup. Takumi never reads system fonts.

### Colour

Any element takes a `grade` — brightness, contrast, saturation, hue, gamma,
lift and gain:

```typescript
s.image("./clip.mp4", {
  width: 1920,
  height: 1080,
  grade: {
    brightness: 0.05,
    contrast: 1.15,
    saturation: 1.2,
    gamma: 1.1,
    lift: [0.02, 0, -0.01],   // per-channel black point
    gain: [1.05, 1.0, 0.95],  // per-channel white point
  },
});
```

| Field | Range | Unchanged at | Effect |
| --- | --- | --- | --- |
| `brightness` | −1…1 | `0` | Adds to every channel |
| `contrast` | 0…3 | `1` | Pivots around mid-grey |
| `saturation` | 0…3 | `1` | `0` is greyscale |
| `hue` | −180…180 | `0` | Degrees of rotation |
| `gamma` | 0.1…10 | `1` | Midtone response |
| `lift` | −1…1 | `0` | Output black point, number or `[r,g,b]` |
| `gain` | 0…2 | `1` | Output white point, number or `[r,g,b]` |

The option is called `grade`, not `color`, because `color` already means font
colour on text elements.

Applied order is fixed — lift/gain, then brightness/contrast/saturation/gamma,
then hue — so the same numbers look the same on every element. A neutral grade
adds no filter at all.

### Shapes

Rectangles, ellipses and lines, drawn to a PNG at compile time and overlaid like
an image — no browser, one file each:

```typescript
import { composition, rect, ellipse, line } from "@glitchoff/kino";

composition({ width: 1080, height: 1920 })
  .scene({ duration: 5, background: "#0f172a" }, (s) =>
    s
      .add(rect({ width: 400, height: 120, x: 80, y: 80, fill: "#38bdf8", radius: 24 }))
      .add(ellipse({ width: 200, height: 200, x: 80, y: 260, fill: "transparent", stroke: "#f8fafc", strokeWidth: 4 }))
      .add(line({ width: 400, height: 200, x: 80, y: 520, x1: 0, y1: 0, x2: 400, y2: 200, stroke: "#f472b6", strokeWidth: 6 }))
  )
  .build();
```

| Option | Applies to | Description |
| --- | --- | --- |
| `width`, `height` | all | The shape's box. Required, and must be positive |
| `fill` | all | Interior colour. `"transparent"` for an outline only |
| `stroke`, `strokeWidth` | all | Border colour and thickness |
| `radius` | `rect` | Corner radius, clamped to half the shorter side |
| `x1`, `y1`, `x2`, `y2` | `line` | End points, relative to the shape's own box |

`shape("rect" \| "ellipse" \| "line", options)` is the general form; `rect`,
`ellipse` and `line` are shorthands.

A shape with neither a fill nor a stroke is rejected rather than silently
drawing nothing.

Shapes exist because the alternative was an `html` element, which drags in
Chrome or Obscura, costs a page render per element, and lays out slightly
differently between the two engines.

### Standalone element helpers

Useful with `map`/`filter` when the content is generated:

```typescript
import { composition, text } from "@glitchoff/kino";

const titles = ["One", "Two", "Three"];

const video = composition({ width: 1080, height: 1920 })
  .scene({ duration: 3 * titles.length, background: "#000" }, (s) =>
    s.addAll(
      titles.map((title, i) =>
        text(title, { fontSize: 96, color: "#fff", x: "center", y: "center", startAt: i * 3, duration: 3 })
      )
    )
  )
  .build();
```

### Reusable components

A component is just a function or a `SceneBuilder` — there is no separate
component model to learn. Four patterns cover most reuse:

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

### Text-to-Speech

Narration is generated locally with [Piper](https://github.com/OHF-Voice/piper1-gpl).
Piper is **external and optional** — Kino spawns the `piper` binary and never
bundles it (its engine is GPL-3.0; the subprocess boundary keeps that out of
this package).

```bash
pip install piper-tts      # install the engine
npx kino setup tts         # verify it and list voices
npx kino setup tts hi_IN-rohan   # download a voice now (~64 MB)
```

Attach speech to a scene with `s.say()`, or to the composition with `tts()`:

```typescript
import { composition, tts } from "@glitchoff/kino";

const video = composition({ width: 1080, height: 1920 })
  .scene({ duration: 4 }, (s) =>
    s
      .text("नमस्ते", { fontSize: 120, x: "center", y: "center-120" })
      .say("नमस्ते, यह Kino से बनाया गया है।", { voice: "hi_IN-rohan" })
  )
  .audio([{ src: tts("Kino is scripting-first.", { voice: "en_US-lessac-medium" }), startTime: 4 }])
  .build();
```

| Voice | Language | Size |
| --- | --- | --- |
| `hi_IN-rohan`, `hi_IN-pratham`, `hi_IN-priyamvada` | Hindi | ~63 MB |
| `en_US-lessac-medium`, `en_US-amy-medium` | English (US) | ~63 MB |
| `en_GB-alba-medium` | English (GB) | ~63 MB |

Options: `voice`, `rate` (1 = normal, 2 = double speed).

Notes:

- Voices download **lazily on first use** into `~/.cache/kino/tts/voices` —
  global, so every project shares them.
- Synthesised audio is cached in `~/.cache/kino/tts/audio`, keyed on
  text + voice + rate. A repeated line is never re-synthesised.
- `--dry-run` never downloads a voice or runs Piper.
- `s.say()` audio starts at the scene's start time, accounting for transition
  overlap.

#### Sizing a scene from its narration

`tts()` defers synthesis to render time, so it cannot tell you how long a line
is. `await voice(...)` synthesises immediately and returns the measured audio:

```typescript
import { composition, voice } from "@glitchoff/kino";

const line = await voice("Where the mind is without fear.", { voice: "en_US-lessac-medium" });

line.seconds; // 1.63 — plain seconds, usable anywhere a duration is
line.path;    // the cached WAV
line.spec;    // the tts() spec, for audio() tracks

const video = composition({ width: 1080, height: 1920 })
  .scene({ duration: { fit: line } }, (s) =>
    s.text("Where the mind\nis without fear", { x: "center", y: "center" }).say(line)
  )
  .build();
```

`duration: { fit: voice }` sets the scene to the speech length plus a tail, so
the last word is never clipped:

| Option | Default | Meaning |
| --- | --- | --- |
| `pad` | `0.6` | Seconds after the speech |
| `lead` | `0` | Seconds before the speech |
| `min` | — | Shortest scene, whatever the speech length |

Because `seconds` is a number, the usual arithmetic works too:

```typescript
comp.scene({ duration: line.seconds + 2 }, (s) => s.say(line));
s.text("…", { animation: fadeIn(Math.min(0.5, line.seconds / 4)) });
```

A `Voice` passed to `s.say()` reuses the audio already synthesised — nothing is
spoken twice — so one measured line can be shared by several scenes. Measuring
is cached by text + voice + rate, so a re-run costs a file read, not a Piper
spawn. Measuring many lines is worth parallelising with `Promise.all`.

See `examples/narration-fit.ts`.

#### Word-level captions

`captions()` turns a measured line into timed caption elements. The words are
already known — they are the line you asked Piper to say — so nothing is
transcribed.

```typescript
import { composition, voice, captions } from "@glitchoff/kino";

const line = await voice("Where the mind is without fear.");

const comp = composition({ width: 1080, height: 1920 })
  .scene({ duration: { fit: line } }, (s) => s.addAll(captions(line, { style: "karaoke" })))
  .build();
```

| Style | Result |
| --- | --- |
| `karaoke` (default) | A group of words; each one lights up as it is spoken |
| `reveal` | Words appear one at a time and stay, so the line builds up as it is sung |
| `word` | One word at a time, replacing the last |
| `block` | Timed subtitles — a group appears together, no highlight |

Options: `wordsPerLine` (4), `y` (`"bottom-240"`), `x`, `fontSize` (56),
`color` (`#f8fafc`), `highlight` (`#38bdf8`), `fade`, `hold`, `zIndex`, `at`.

**Timing.** `captions()` spreads words across the audio by length, pausing at
punctuation. That is accurate for TTS, which reads at a steady pace, and needs
nothing installed. For exact timing use forced alignment:

```bash
npx kino setup captions   # installs the optional aligner and its model (~317 MB)
```

```typescript
const caps = await captionsAsync(line, { style: "karaoke" });
```

`captionsAsync()` uses alignment when it is available and falls back to even
timing when it is not, so the same code works with or without the model.

The aligner is **never a dependency**. `setup captions` installs it into
`~/.cache/kino/captions` rather than your project, so no manifest or lockfile
changes and every project on the machine shares one copy. The model downloads
on first use into the same directory. Captions work fine if you skip all of
this — you just get even timing instead of aligned timing.

Notes:

- A caption's highlight is drawn by re-rendering the line and cropping to the
  active word's box, so captions work with any font and any wrapping.
- Word boxes are estimated from character widths; the crop is padded so a
  word is never cut mid-glyph.
- Captions are plain `TextElement`s — they mix with other elements and honour
  `zIndex`, so they need no special renderer.

See `examples/captions.ts`.

##### Word highlight for long videos

The `karaoke` style above draws the line again for every word, so ffmpeg keeps
a full-frame copy alive per word. That is fine for a sentence and collapses on
a song: past roughly six lines the render stalls and never finishes.

For anything long, rasterise the words instead. `captionImages()` draws each
word state to a PNG once and returns one image per word, timed to that word's
span. The composition only swaps images on a timeline, so per-frame cost does
not grow with the word count — a 163 s song with word-level highlight renders
in about two minutes.

```typescript
import { captionImages, composition } from "@glitchoff/kino";

const frames = await captionImages(timings, {
  width: 2560, height: 280,                 // render size (2x)
  displayWidth: 1280, displayHeight: 140,   // on-screen size
  dir: "/tmp/karaoke-frames",
  fontSize: 132,
  wordsPerLine: 5,
  color: "#ffffff",
  highlight: "#f5b544",
  x: 0,
  y: 290,
});
```

`timings` is the same `WordTiming[]` that `captions()` accepts.

Which to use:

| Situation | Use |
| --- | --- |
| A sentence or a few lines | `karaoke` — no temp files, no rasterising |
| A full song or many lines | `captionImages()` — cost stays flat |
| No highlight needed | `block` — fastest of all |

Things that are easy to get wrong:

- **Pass every timing at once.** Lines are grouped and each line's hold is
  trimmed so it cannot run into the next one, which needs to see the following
  line. Calling `captionImages()` once per line leaves holds untrimmed and
  stacks two lines on screen.
- **`width`/`height` are the PNG size, not the screen size.** Set
  `displayWidth`/`displayHeight` to the size the strip should occupy. Rasterise
  at 2x for crisp text; 1x looks soft next to `karaoke` once the encoder scales
  it.
- **Do not animate the word frames.** Each frame replaces the last, so a fade or
  slide restarts on every word and the line flickers.
- **Word widths are measured from the rasterised text**, not estimated from
  character classes, so the gaps between words stay even.

See `examples/lyrics.ts` (`KINO_LYRICS_STYLE=frames`).

### Plain objects, still typed

If you prefer object literals, wrap them in `defineComposition` to get checking
and autocomplete without the builder:

```typescript
import { defineComposition } from "@glitchoff/kino";

export default defineComposition({
  width: 1080,
  scenes: [{ duration: 5, elements: [{ type: "text", content: "Hi" }] }],
});
```

### Checking a composition without rendering

`inspect()` reports geometry and layout problems in one call — no ffmpeg
render, no browser:

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

Text width is read from the font's advance tables, so the numbers match what
drawtext renders. `inspect()` is synchronous and starts nothing — no ffmpeg, no
browser.

### Animation helpers

| Helper | Produces |
| --- | --- |
| `animate({ from, to, duration, easing })` | Arbitrary value animation |
| `fadeIn(duration?, easing?)` | `opacity` 0 → 1 |
| `fadeOut(duration?, easing?)` | `opacity` 1 → 0 |
| `slideIn("x" \| "y", distance, duration?, easing?)` | Position offset → 0 |
| `popIn(duration?, easing?)` | `scale` 0.8 → 1 |

#### Keyframes

`animate()` interpolates one segment between two values. For anything with more
than one beat, give a channel a keyframe list instead:

```typescript
s.text("Title", {
  x: "center",
  y: "center",
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

`at` is seconds from the element's `startAt`, matching `steps`. `easing` on a
keyframe describes the segment *arriving* at it, so the first keyframe's easing
is unused and the last one's applies on the way in. Omit it to inherit the
track's `easing`, which defaults to `easeInOut`.

`{ from, to, duration }` is sugar for two keyframes and stays the simpler form
when there are only two.

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

The overshooting curves (`*Back`, `easeOutElastic`) intentionally pass the end
value before settling — that is the effect, not an error.

### Option aliases

Builder options mirror the composition fields, with friendlier names:

| Builder option | Composition field |
| --- | --- |
| `color` | `fontColor` |
| `align` | `textAlign` |

Unset options are omitted entirely, so the emitted object is clean, JSON-safe
data.

### Using code compositions from the CLI

```bash
npx kino scene.ts -o out.mp4       # TypeScript
npx kino scene.js -o out.mp4       # JavaScript / ESM
npx kino scene.json -o out.mp4     # JSON still works
```

The module must export the composition — `export default` is preferred; a named
`composition` or `scene` export also works. Exporting a function is allowed and
is called at load time, so a composition can be generated per run:

```typescript
import { composition } from "@glitchoff/kino";

export default () =>
  composition({ width: 1080, height: 1920 })
    .scene({ duration: 5 }, (s) => s.text(new Date().toISOString(), { fontSize: 48, x: "center" }))
    .build();
```

> **Note:** `.ts` input is loaded through Node's module loader. Use a Node version
> with type stripping (22.6+ with `--experimental-strip-types`, on by default in
> newer releases) or run the CLI through `tsx`.

---

## 🖥️ CLI Usage

Kino comes with a CLI utility for compiling and rendering composition files (JSON or code) and pre-compiled `.kino` artifacts. GPU hardware encoding is used by default when available.

### Render to Video (GPU-first by default)

```bash
# GPU hardware encoder (auto-detected; falls back to CPU if unavailable)
npx kino path/to/scene.json -o output.mp4

# Code composition (TypeScript or JavaScript)
npx kino path/to/scene.ts -o output.mp4

# Explicit CPU
npx kino path/to/scene.json -o output.mp4 --encoder libx264
```

### Render Pre-compiled `.kino` Artifacts

`.kino` files are self-contained archives (produced by `--dry-run` or `compile()`) that can be rendered without recompiling:

```bash
# Render an existing .kino artifact directly (fully offline, no recompilation)
npx kino path/to/composition.kino -o output.mp4
```

`--gpu` (and `encoder: "auto"`) probes the actual hardware on the host machine and picks the best available GPU encoder for it — NVENC → QSV → AMF on Windows, VideoToolbox on macOS, NVENC → QSV → VAAPI on Linux — then falls back to CPU `libx264` if no GPU encoder is usable.

Encoder presets are validated per encoder: NVENC accepts `p1`–`p7` (invalid or x264-only presets are replaced with `p2`), AMF maps to `speed`/`balanced`/`quality`, QSV and `libx264` accept the x264-style presets (`veryfast`, `medium`, `slow`, …).

### Dry Run (Inspect FFmpeg Command)

```bash
npx kino path/to/scene.json --dry-run
```

`--dry-run` compiles to a portable `.kino` artifact (downloading any remote `http(s)` assets referenced by the composition into the archive), then prints the FFmpeg command (all relative paths — no live URLs) without rendering. The artifact and its renders are fully offline and reproducible.

### Fast Previews

```bash
npx kino scene.ts --preview              # 144p, ultrafast
npx kino scene.ts --preview 480          # readable text
npx kino scene.ts --preview --dry-run    # just inspect the graph
```

`--preview` only changes the **output stage** — the final video is downscaled and
encoded with `ultrafast`. The scene graph is untouched, so a preview that looks
right will render right. Treat 144p as a *layout* preview: text is not legible.

### Rendering One Scene

```bash
npx kino scene.ts --scene intro            # only that scene
npx kino scene.ts --scene intro --preview  # fastest possible loop
```

`--scene <id>` compiles just that scene, with its timeline rebased to zero. Use
it while authoring a long composition — the cost scales with the scene, not the
whole video. A selected scene drops its transition, since there is no preceding
scene to transition from. Ids default to `scene-1`, `scene-2`, …; set
`id: "intro"` on a scene to name it.

### Asset Cache

Remote `http(s)` assets are cached on disk, keyed by a hash of the URL, so
re-renders skip the download. Assets are fetched in parallel, and each unique URL
is downloaded once even if several elements reference it.

```bash
npx kino scene.ts --no-asset-cache        # force re-download
npx kino scene.ts --asset-cache-dir /tmp/kino-assets
```

The cache defaults to `.kino-cache/` in the working directory (add it to
`.gitignore`), falling back to `~/.cache/kino/assets` when that is not writable.
Deleting the directory is always safe.

### Text Delivery & `--unsafe-inline-text`

Text elements are delivered to drawtext via a portable `.kino` artifact (a self-contained zip with relative paths) containing the compiled FFmpeg command and all text/asset files — so apostrophes, colons, and special characters render reliably, and the artifact can be copied to another machine or OS and rendered as-is. Only if you cannot write temp files, pass `--unsafe-inline-text` — this disables textfile delivery and passes text inline, which **may render text containing apostrophes blank on some platforms** (a warning is printed to stderr):

```bash
npx kino path/to/scene.json --unsafe-inline-text
```

---

## ✨ Scene Transitions

Scenes play sequentially and can transition into each other with 11 built-in transition types. A transition belongs to the **entering** scene and is applied via FFmpeg's `xfade` filter:

```json
{
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "scenes": [
    {
      "duration": 5,
      "background": "#0f172a",
      "elements": [
        {
          "type": "text",
          "content": "Scene One",
          "fontSize": 64,
          "fontColor": "#ffffff",
          "x": "center",
          "y": "center"
        }
      ]
    },
    {
      "duration": 5,
      "background": "#312e81",
      "transition": { "type": "slideLeft", "duration": 1 },
      "elements": [
        {
          "type": "text",
          "content": "Scene Two",
          "fontSize": 64,
          "fontColor": "#a5b4fc",
          "x": "center",
          "y": "center"
        }
      ]
    }
  ]
}
```

### Supported Transition Types

| Type | Description | Preview |
| :--- | :--- | :--- |
| `fade` | Cross-fade between scenes. | <video src="/kino/previews/transition-fade.mp4" muted loop autoplay playsinline width="160"></video> |
| `slideLeft` | New scene slides in from the left. | <video src="/kino/previews/transition-slideLeft.mp4" muted loop autoplay playsinline width="160"></video> |
| `slideRight` | New scene slides in from the right. | <video src="/kino/previews/transition-slideRight.mp4" muted loop autoplay playsinline width="160"></video> |
| `slideUp` | New scene slides in from the bottom. | <video src="/kino/previews/transition-slideUp.mp4" muted loop autoplay playsinline width="160"></video> |
| `slideDown` | New scene slides in from the top. | <video src="/kino/previews/transition-slideDown.mp4" muted loop autoplay playsinline width="160"></video> |
| `wipeLeft` | New scene wipes from left to right. | <video src="/kino/previews/transition-wipeLeft.mp4" muted loop autoplay playsinline width="160"></video> |
| `wipeRight` | New scene wipes from right to left. | <video src="/kino/previews/transition-wipeRight.mp4" muted loop autoplay playsinline width="160"></video> |
| `wipeUp` | New scene wipes from bottom to top. | <video src="/kino/previews/transition-wipeUp.mp4" muted loop autoplay playsinline width="160"></video> |
| `wipeDown` | New scene wipes from top to bottom. | <video src="/kino/previews/transition-wipeDown.mp4" muted loop autoplay playsinline width="160"></video> |
| `zoomIn` | New scene zooms in from center. | <video src="/kino/previews/transition-zoomIn.mp4" muted loop autoplay playsinline width="160"></video> |
| `zoomOut` | New scene zooms out to center. | <video src="/kino/previews/transition-zoomOut.mp4" muted loop autoplay playsinline width="160"></video> |

The transition `duration` must not exceed the duration of either adjacent scene. Total composition duration equals `sum(scene.duration) - sum(transition.duration)`.

Try the included examples:

```bash
# Showcase all 11 transitions
npx kino examples/all-transitions.ts -o all-transitions.mp4

# Basic scene transitions demo
npx kino examples/scene-transitions.ts -o scene-transitions.mp4
```

---

## 🎨 Kino Studio Playground

Kino includes an interactive web studio with a syntax-highlighted JSON editor and a render panel: encoder + quality selects (the quality presets adapt to the chosen encoder), a one-click render button, and an HTML5 video player:

```bash
npx kino studio --port 3333
```

Open `http://localhost:3333` in your browser to start building scenes visually!
