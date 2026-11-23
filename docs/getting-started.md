# Getting started

Kino is a TypeScript library that compiles a composition into an FFmpeg command
and renders it to MP4. You describe scenes, elements and timing; kino works out
the filter graph.

It is built to be checked before it is rendered. Every page here ends with how to
see the result cheaply — a dry run, a text measurement, a scrubbed frame — rather
than a full encode.

# Installation

```bash
pnpm add @glitchoff/kino   # or: npm install @glitchoff/kino
```

FFmpeg is resolved automatically: Kino ships a vendored Linux build that
includes `drawtext`, and falls back to `ffmpeg-static` elsewhere. Point it
somewhere else with `--ffmpeg-path`.

## Optional pieces

Nothing below is required. Each one enables a single feature.

| Feature | Needs | Setup |
| --- | --- | --- |
| `s.html()` | Chrome or Chromium | `npx puppeteer browsers install chrome` |
| `s.html()` without a browser | nothing extra | already installed with kino (`takumi-js`) |
| `s.tak()` | nothing | built in |
| Narration (`tts()`, `s.say()`) | [Piper](https://github.com/OHF-Voice/piper1-gpl) on `PATH` | see [Sound](#sound) |
| `yt:` sources | `yt-dlp` on `PATH` | see [Images and video](#images-and-video) |
| Word-level caption alignment | an aligner | see [Captions](#captions) |
| GPU caption text (`render: "gpu"`) | the `gpucap` binary | `npx kino setup gpucap` |

Using Obscura instead of Chrome is covered in [Rendering](#rendering).

### GPU caption text

`gpucap` is a small Rust binary that draws caption text through a GPU glyph
atlas instead of ffmpeg's `drawtext`.

```bash
npx kino setup gpucap      # downloads the binary for this platform
```

**It is not automatically faster.** On a real 5:16 chapter it rendered 10%
*slower* than `drawtext` (238 s against 216 s), because each caption becomes a
PNG that is written, read back, decoded and uploaded. Measure before switching a
chapter over — see [Content](./content.md#measure-before-you-switch).

Without it, captions render with `drawtext` exactly as before — the feature is
opt-in and its absence is never an error. To build it yourself:

```bash
cd rust/gpucap && cargo build --release   # needs Rust; see rust-toolchain.toml
```

Then either put `gpucap` on `PATH`, or point `gpuTextPath` at it. The toolchain
is pinned in `rust-toolchain.toml` and the crates in `Cargo.lock`, so a local
build matches the released one.

See [Content](./content.md#gpu-text-opt-in) for the options.

---

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

The same file runs from the command line as `npx kino welcome.ts -o out.mp4`, as
long as it has a default export.

---

## Where to go next

The rest of the guide is in reading order. Each page stands alone if you already
know what you are looking for.

| Page | Covers |
| --- | --- |
| [Compositions](./compositions.md) | Scenes, the builder, reusable parts |
| [Content](./content.md) | Text, images, video, shapes, HTML, captions |
| [Look](./look.md) | Colour grading, compositing, animation, transitions |
| [Sound](./sound.md) | Narration, music, ducking |
| [Checking your work](./checking.md) | Dry runs, `inspect()`, `measureText()`, preview |
| [Rendering](./rendering.md) | The CLI, from code, hardware, browsers |
