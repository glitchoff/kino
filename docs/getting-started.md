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

// 2. Render directly to MP4 with GPU acceleration
async function run() {
  console.log("Rendering video...");
  const result = await render(composition, {
    output: "./welcome.mp4",
    encoder: "h264_nvenc", // NVIDIA NVENC GPU acceleration
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

### Dry Run (Inspect FFmpeg Command)

```bash
npx kino path/to/scene.json --dry-run
```

---

## 🎨 Kino Studio Playground

Kino includes an interactive web studio with a JSON code editor, live FFmpeg command inspector, GPU hardware encoder selection, and HTML5 video player:

```bash
npx kino studio --port 3333
```

Open `http://localhost:3333` in your browser to start building scenes visually!
