# Kino

A minimal TypeScript library, CLI, and local web studio for compiling basic JSON compositions into FFmpeg video renders.

Currently in initial development (`v0.1.0`).

---

## What It Does

- **JSON to FFmpeg**: Converts canvas dimensions, background colors, duration, and text element timelines into FFmpeg filtergraph commands (`drawtext`).
- **Binary Fallback**: Bundles `ffmpeg-static` so it works out of the box if `ffmpeg` isn't in system `PATH`.
- **Kino Studio**: Local web editor (powered by Hono) to tweak JSON compositions, preview the generated FFmpeg command, and trigger video renders.
- **Dual Build**: Outputs ESM and CommonJS bundles via `tsup`.

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
    duration: 5,
    background: "#000000",
    fps: 30,
    text: [
      {
        content: "Hello Kino",
        fontSize: 72,
        fontColor: "white",
        x: "center",
        y: "center",
        startTime: 0,
        duration: 3
      }
    ]
  },
  { output: "./out.mp4" }
);
```

### CLI

```bash
# Render JSON to MP4
npx kino examples/basic.json -o out.mp4

# Inspect generated FFmpeg command
npx kino examples/basic.json --dry-run
```

### Kino Studio (Visual Web Editor)

```bash
# Launch studio from CLI
npx kino studio

# Or specify custom port
npx kino studio --port 3333
```

Opens at `http://localhost:3333` with live file watching (`tsx watch`).

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
