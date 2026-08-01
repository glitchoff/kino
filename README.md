# Kino

A high-performance TypeScript library, CLI, and local web studio for compiling JSON scene compositions into FFmpeg video renders.

---

## ⚡ Key Features

- **Mandatory `scenes[]` Primitive**: Modular, scene-driven timeline architecture with relative element positioning.
- **GPU Hardware Acceleration**: Native support for NVIDIA (`h264_nvenc`, `hevc_nvenc`), Intel (`h264_qsv`), AMD (`h264_amf`), and Apple VideoToolbox with automatic CPU (`libx264`) fallback.
- **Sequential & Absolute Timelines**: Automatic end-to-end scene sequencing or explicit absolute start time layer stacking.
- **Audio & SFX Mixing**: Multi-track background music with fade-in/fade-out and element-level sound effect triggers.
- **Kino Studio**: Local web editor (powered by Hono) with live FFmpeg command preview and GPU encoder controls.
- **Binary Fallback**: Bundles `ffmpeg-static` for instant zero-config execution.

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
import { render } from "kino";

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
# Render JSON to MP4 using CPU
npx kino examples/basic.json -o out.mp4

# GPU Accelerated Render (NVIDIA NVENC with CPU fallback)
npx kino examples/basic.json -o out.mp4 --gpu

# Explicit Encoder
npx kino examples/basic.json -o out.mp4 --encoder h264_nvenc

# Inspect generated FFmpeg command
npx kino examples/basic.json --dry-run
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
