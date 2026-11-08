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

Using Obscura instead of Chrome is covered in [Rendering](#rendering).

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
