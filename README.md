# Kino

A high-performance TypeScript library, CLI, and local web studio for compiling JSON scene compositions into FFmpeg video renders.

---

## ⚡ Key Features

- **Mandatory `scenes[]` Primitive**: Modular, scene-driven timeline architecture with relative element positioning.
- **Layering (`zIndex`)**: Optional `zIndex` controls draw order across a composition. When omitted, elements stack in declaration order; when set, lower values render first (background) and higher values render on top. Stable, declaration-order-respecting, composition-global.
- **Per-Element Animations**: `opacity`, `x`, `y`, and `scale` animations with `from`/`to`/`duration`/`delay`/easing curves (`"linear"`, `"easeIn"`, `"easeOut"`, `"easeInOut"`). Animations use an element-local clock, hold `from`→interpolate→hold `to`, and clip (never rescale the layer) past the element's own duration.
- **GPU Hardware Acceleration**: Native support for NVIDIA (`h264_nvenc`, `hevc_nvenc`), Intel (`h264_qsv`), AMD (`h264_amf`), and Apple VideoToolbox. `encoder: "auto"` (the default) probes the host machine and picks the best available GPU encoder before rendering, with automatic CPU (`libx264`) fallback when the GPU path fails.
- **Sequential & Absolute Timelines**: Automatic end-to-end scene sequencing or explicit absolute start time layer stacking.
- **Audio & SFX Mixing**: Multi-track background music with fade-in/fade-out and element-level sound effect triggers.
- **Kino Studio**: Local web editor (powered by Hono) with live FFmpeg command preview and GPU encoder controls.
- **Binary Fallback**: Bundles `ffmpeg-static` for instant zero-config execution.
- **Portable `.kino` Artifacts**: `compile()` produces a self-contained zip (relative paths, text/asset files included) that can be archived, cached, or handed to another machine and rendered as-is. Remote `http(s)` asset URLs are downloaded into the archive at compile time so the artifact and its renders are **fully offline** and reproducible.

---

## Installation

```bash
# Using pnpm
pnpm add @glitchoff/kino

# Using npm
npm install @glitchoff/kino
```

---

## Example Usage

### Programmatic

```typescript
import { render } from "@glitchoff/kino";

await render(
  {
    width: 1080,
    height: 1920,
    fps: 30,
    scenes: [
      {
        duration: 5,
        background: "#0f172a",
        elements: [
          {
            type: "text",
            content: "Hello Kino",
            fontSize: 72,
            fontColor: "white",
            x: "center",
            y: "center",
            startTime: 0,
            duration: 3
          }
        ]
      }
    ]
  },
  { output: "./out.mp4", encoder: "h264_nvenc" } // High-speed NVIDIA GPU render
);
```

### CLI

```bash
# Render JSON to MP4 (GPU-first by default; falls back to CPU if no GPU)
npx kino examples/basic.json -o out.mp4

# GPU Accelerated Render (NVIDIA NVENC with CPU fallback)
npx kino examples/basic.json -o out.mp4 --gpu

# Explicit Encoder
npx kino examples/basic.json -o out.mp4 --encoder h264_nvenc

# Compile to a portable .kino artifact (downloads remote assets into the zip) then inspect
npx kino examples/basic.json --dry-run

# Opt out of textfile text delivery (DANGEROUS: apostrophes may render blank)
npx kino examples/basic.json --unsafe-inline-text
```

### Kino Studio (Visual Web Editor)

```bash
npx kino studio --port 3333
```

Opens at `http://localhost:3333` with GPU hardware encoder selection controls.

---

## Documentation

Full docs are available in [`docs/`](./docs):
- [Getting Started](./docs/getting-started.md)
- [Schema Reference](./docs/schema-reference.md)
- [API Reference](./docs/api-reference.md)
- [Kino Studio Guide](./docs/studio.md)

---

## License

MIT
