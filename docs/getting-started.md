# Getting Started with Kino

Kino allows you to specify video scenes using declarative JSON objects and compile them to MP4 videos via FFmpeg.

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
npx kino examples/html-showcase.json -o html-showcase.mp4 \
  --browser-path "C:\Program Files\Google\Chrome\Application\chrome.exe"
```

The browser is needed only while compiling HTML into the `.kino` artifact. Once compiled, the artifact contains the rasterized PNG and can render without a browser.

> **Note:** Kino includes a built-in FFmpeg binary fallback on every platform, so manual installation of an FFmpeg binary is optional. Windows and macOS use `ffmpeg-static`; Linux ships a pinned drawtext-enabled build (ffmpeg-static's Linux binary predates the FFmpeg 6.1 `libharfbuzz` requirement, so text would otherwise fail silently). Both are installed automatically at package install. To install or verify them manually:

> ```bash
> npx kino setup ffmpeg
> ```

> **Note:** Text elements use **Inter Regular** by default (bundled in the package). For custom fonts, set `fontFile` on the element.

---

## 🚀 Programmatic Quickstart

Create a TypeScript or JavaScript file (e.g., `index.ts`):

```typescript
import { render } from "@glitchoff/kino";

// 1. Define composition with mandatory scenes primitive
const composition = {
  width: 1920,
  height: 1080,
  fps: 30,
  scenes: [
    {
      duration: 5,
      background: "#0f172a",
      elements: [
        {
          type: "text",
          content: "Welcome to Kino",
          fontSize: 64,
          fontColor: "#38bdf8",
          x: "center",
          y: "center",
          startAt: 0,
          duration: 5
        }
      ]
    }
  ]
};

// 2. Render directly to MP4 with automatic hardware acceleration
async function run() {
  console.log("Rendering video...");
  const result = await render(composition, {
    output: "./welcome.mp4",
    encoder: "auto", // probes the machine and picks the best available GPU encoder
    verbose: true
  });
  console.log(`Video rendered successfully to ${result.output}`);
}

run();
```

---

## 🖥️ CLI Usage

Kino comes with a CLI utility for compiling and rendering JSON composition files and pre-compiled `.kino` artifacts. GPU hardware encoding is used by default when available.

### Render JSON to Video (GPU-first by default)

```bash
# GPU hardware encoder (auto-detected; falls back to CPU if unavailable)
npx kino path/to/scene.json -o output.mp4

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
npx kino examples/all-transitions.json -o all-transitions.mp4

# Basic scene transitions demo
npx kino examples/scene-transitions.json -o scene-transitions.mp4
```

---

## 🎨 Kino Studio Playground

Kino includes an interactive web studio with a syntax-highlighted JSON editor and a render panel: encoder + quality selects (the quality presets adapt to the chosen encoder), a one-click render button, and an HTML5 video player:

```bash
npx kino studio --port 3333
```

Open `http://localhost:3333` in your browser to start building scenes visually!
