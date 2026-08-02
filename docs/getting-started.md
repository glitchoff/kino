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

> **Note:** Kino includes built-in binary fallback (`ffmpeg-static`), so manual installation of an FFmpeg binary is optional!

---

## 🚀 Programmatic Quickstart

Create a TypeScript or JavaScript file (e.g., `index.ts`):

```typescript
import { render } from "kino";

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
          startTime: 0,
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

Kino comes with a CLI utility for compiling and rendering JSON composition files.

### Render JSON to Video (CPU)

```bash
npx kino path/to/scene.json -o output.mp4
```

### GPU Accelerated Render

```bash
# Auto GPU hardware acceleration with automatic CPU fallback
npx kino path/to/scene.json -o output.mp4 --gpu

# Target specific encoder
npx kino path/to/scene.json -o output.mp4 --encoder h264_nvenc
```

`--gpu` (and `encoder: "auto"`) probes the actual hardware on the host machine and picks the best available GPU encoder for it — NVENC → QSV → AMF on Windows, VideoToolbox on macOS, NVENC → QSV → VAAPI on Linux — then falls back to CPU `libx264` if no GPU encoder is usable.

Encoder presets are validated per encoder: NVENC accepts `p1`–`p7` (invalid or x264-only presets are replaced with `p2`), AMF maps to `speed`/`balanced`/`quality`, QSV and `libx264` accept the x264-style presets (`veryfast`, `medium`, `slow`, …).

### Dry Run (Inspect FFmpeg Command)

```bash
npx kino path/to/scene.json --dry-run
```

### Text Delivery & `--unsafe-inline-text`

Text elements are delivered to drawtext via a portable `.kino` artifact (a self-contained zip with relative paths) containing the compiled FFmpeg command and all text/asset files — so apostrophes, colons, and special characters render reliably, and the artifact can be copied to another machine or OS and rendered as-is. Only if you cannot write temp files, pass `--unsafe-inline-text` — this disables textfile delivery and passes text inline, which **may render text containing apostrophes blank on some platforms** (a warning is printed to stderr):

```bash
npx kino path/to/scene.json --unsafe-inline-text
```

---

## 🎨 Kino Studio Playground

Kino includes an interactive web studio with a syntax-highlighted JSON editor and a render panel: encoder + quality selects (the quality presets adapt to the chosen encoder), a one-click render button, and an HTML5 video player:

```bash
npx kino studio --port 3333
```

Open `http://localhost:3333` in your browser to start building scenes visually!
