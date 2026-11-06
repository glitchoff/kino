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

### Animation helpers

| Helper | Produces |
| --- | --- |
| `animate({ from, to, duration, easing })` | Arbitrary value animation |
| `fadeIn(duration?, easing?)` | `opacity` 0 → 1 |
| `fadeOut(duration?, easing?)` | `opacity` 1 → 0 |
| `slideIn("x" \| "y", distance, duration?, easing?)` | Position offset → 0 |
| `popIn(duration?, easing?)` | `scale` 0.8 → 1 |

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

| Type | Description |
| :--- | :--- |
| `fade` | Cross-fade between scenes. |
| `slideLeft` | New scene slides in from the left. |
| `slideRight` | New scene slides in from the right. |
| `slideUp` | New scene slides in from the bottom. |
| `slideDown` | New scene slides in from the top. |
| `wipeLeft` | New scene wipes from left to right. |
| `wipeRight` | New scene wipes from right to left. |
| `wipeUp` | New scene wipes from bottom to top. |
| `wipeDown` | New scene wipes from top to bottom. |
| `zoomIn` | New scene zooms in from center. |
| `zoomOut` | New scene zooms out to center. |

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
