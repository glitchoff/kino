# Kino

A high-performance TypeScript library, CLI, and local web studio for compiling JSON scene compositions into FFmpeg video renders.

---

## ⚡ Key Features

- **Mandatory `scenes[]` Primitive**: Modular, scene-driven timeline architecture with relative element positioning.
- **Layering (`zIndex`)**: Optional `zIndex` controls draw order across a composition. When omitted, elements stack in declaration order; when set, lower values render first (background) and higher values render on top. Stable, declaration-order-respecting, composition-global.
- **Scene Transitions**: 11 built-in transition types (`fade`, `slideLeft`, `slideRight`, `slideUp`, `slideDown`, `wipeLeft`, `wipeRight`, `wipeUp`, `wipeDown`, `zoomIn`, `zoomOut`) that overlap adjacent scenes using FFmpeg `xfade` filters. Transitions belong to the entering scene; the first scene in a composition cannot define one. Total composition duration equals `sum(scene.duration) - sum(transition.duration)`.
- **Per-Element Animations**: `opacity`, `x`, `y`, and `scale` animations with `from`/`to`/`duration`/`delay`/easing curves (`"linear"`, `"easeIn"`, `"easeOut"`, `"easeInOut"`). Animations use an element-local clock, hold `from`→interpolate→hold `to`, and clip (never rescale the layer) past the element's own duration.
- **Precise Positioning**: Anchor elements with `"center"`, `"start"`, `"end"`, or expressions via `x`/`y`, then nudge with `offsetX`/`offsetY` pixel offsets. Animations layer on top for motion. See **Positioning** in the schema reference.
- **Text Layout & Styling**: Automatic word wrapping via `maxWidth` (preserves hard newlines and oversized tokens), multi-line alignment (`textAlign`: `"left"` | `"center"` | `"right"`), multiplier-based line spacing (`lineHeight`), text outline (`stroke`: `{ color, width }`), and drop shadow (`shadow`: `{ color, x, y }`). Includes **bundled Inter font** for consistent cross-platform rendering.
- **Templates**: Reusable named property bags (`templates`) that reduce repetition across elements. Templates are resolved at compile time and stripped before rendering. Supports deep merge with element props winning on conflicts. See **Templates** in the schema reference.
- **GPU Hardware Acceleration**: Native support for NVIDIA (`h264_nvenc`, `hevc_nvenc`), Intel (`h264_qsv`), AMD (`h264_amf`), and Apple VideoToolbox. `encoder: "auto"` (the default) probes the host machine and picks the best available GPU encoder before rendering, with automatic CPU (`libx264`) fallback when the GPU path fails.
- **Audio & SFX Mixing**: Multi-track background music with fade-in/fade-out and element-level sound effect triggers.
- **Kino Studio**: Local web editor (powered by Hono) with live FFmpeg command preview and GPU encoder controls.
- **Binary Fallback**: Bundles `ffmpeg-static` for instant zero-config execution.
- **Portable `.kino` Artifacts**: `compile()` produces a self-contained zip (relative paths, text/asset files included) that can be archived, cached, or handed to another machine and rendered as-is. Remote `http(s)` asset URLs are downloaded into the archive at compile time so the artifact and its renders are **fully offline** and reproducible.

---

## Installation

```bash
# Using pnpm
pnpm add @glitchoff/kino
pnpm approve-builds

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
            offsetY: -40,
            startAt: 0,
            duration: 3,
            animation: {
              y: { from: 20, to: 0, duration: 0.6, easing: "easeOut" }
            }
          }
        ]
      }
    ]
  },
  { output: "./out.mp4", encoder: "h264_nvenc" }
);
```

### CLI

```bash
# Render the official Kino trailer composition to MP4 (GPU-first by default)
npx kino examples/official.json -o trailer.mp4

# GPU Accelerated Render (NVIDIA NVENC with CPU fallback)
npx kino examples/official.json -o trailer.mp4 --gpu

# Explicit Encoder
npx kino examples/official.json -o trailer.mp4 --encoder h264_nvenc

# Compile to a portable .kino artifact (downloads remote assets into the zip) then inspect
npx kino examples/official.json --dry-run

# Opt out of textfile text delivery (DANGEROUS: apostrophes may render blank)
npx kino examples/basic.json --unsafe-inline-text

# Render all 11 scene transitions in one video
npx kino examples/all-transitions.json -o all-transitions.mp4

# Render a pre-compiled .kino artifact (fully offline, no recompilation)
npx kino path/to/composition.kino -o output.mp4
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
