# Programmatic API Reference

Kino exports core compiler and renderer functions for Node.js and TypeScript applications.

```typescript
import { render, compile } from "@glitchoff/kino";
import type { KinoComposition, RenderOptions, CompileResult, VideoEncoder } from "@glitchoff/kino";
```

`render()` and `compile()` accept a plain `KinoComposition` — whether parsed from
JSON, built with `composition()`, or wrapped in `defineComposition()`. They all
produce the same data shape.

---

## Builder

A small, chainable API that emits a plain `KinoComposition`. Nothing downstream
distinguishes it from JSON.

```typescript
import { composition, text, image, fadeIn } from "@glitchoff/kino";

const video = composition({ width: 1080, height: 1920, fps: 30 })
  .scene({ duration: 8, background: "#0f172a", transition: "fade" }, (s) =>
    s
      .text("Title", { fontSize: 84, color: "#fff", x: "center", animation: { opacity: fadeIn(0.6) } })
      .image("https://example.com/a.jpg", { width: 640, x: "center", startAt: 2 })
  )
  .build();
```

### `composition(options)`

| Option | Type | Notes |
| --- | --- | --- |
| `width` | `number \| string` | Canvas width |
| `height` | `number \| string` | Canvas height |
| `fps` | `number \| string` | Frame rate |
| `audio` | `AudioTrack \| AudioTrack[]` | Audio bed |
| `templates` | `KinoTemplate[]` | Reusable element templates |

Returns a `CompositionBuilder`.

### `CompositionBuilder`

| Method | Description |
| --- | --- |
| `.scene(options, cb?)` | Add a scene; `cb` receives a `SceneBuilder` |
| `.addScene(scene)` | Append a raw `KinoScene` |
| `.addScenes(scenes)` | Append several raw scenes |
| `.audio(tracks)` | Set the audio bed |
| `.template(t)` | Register a template |
| `.build()` | Return the `KinoComposition` |

`SceneOptions` accepts `id`, `duration`, `background`, and `transition` (either a
`KinoTransitionType` string, which expands to `{ type, duration: 0.5 }`, or a full
`KinoTransition` object).

### `SceneBuilder`

| Method | Description |
| --- | --- |
| `.text(content, options?)` | Add a text element |
| `.image(src, options?)` | Add an image element |
| `.video(src, options?)` | Add a video element |
| `.html(markup, options)` | Add an HTML element (`width`/`height` required) |
| `.add(element)` | Add any raw element |
| `.addAll(elements)` | Add several elements |

### Element factories

The same helpers are exported standalone and return the element directly, which
is convenient with `map`:

```typescript
import { composition, text } from "@glitchoff/kino";

composition().scene({ duration: 3 }, (s) =>
  s.addAll(["One", "Two"].map((label, i) => text(label, { startAt: i, duration: 1 })))
);
```

`text()`, `image()`, `video()`, `html()` — options mirror the composition fields,
with `color` → `fontColor` and `align` → `textAlign`.

#### Chroma key

`image()` and `video()` accept `chromaKey` to key out a background colour
(green/blue screen). The layer is composited in RGBA, so the keyed pixels become
transparent instead of black.

```typescript
s.video("./greenscreen.mp4", {
  width: 1280,
  height: 720,
  fit: "cover",
  chromaKey: { color: "#00ff00", similarity: 0.15, blend: 0.1, despill: true },
});
```

| Field | Default | Meaning |
| --- | --- | --- |
| `color` | `"#00ff00"` | Key colour to remove. `true` keys green with defaults. |
| `similarity` | `0.01` | How close to the key colour counts as background (0–1). Raise for uneven lighting. |
| `blend` | `0` | Softens the edge between keyed and kept pixels (0–1). |
| `despill` | `false` | Removes colour bleed from the key colour on the subject. |

### Animation helpers

| Helper | Returns | Preview |
| --- | --- | --- |
| `animate({ from, to, duration, delay?, easing? })` | `AnimationValue` | — |
| `fadeIn(duration = 0.5, easing = "easeOut")` | opacity 0 → 1 | <video src="/kino/previews/animation-fadeIn.mp4" muted loop autoplay playsinline width="160"></video> |
| `fadeOut(duration = 0.5, easing = "easeIn")` | opacity 1 → 0 | <video src="/kino/previews/animation-fadeOut.mp4" muted loop autoplay playsinline width="160"></video> |
| `slideIn(axis, distance, duration = 0.5, easing = "easeOut")` | position offset → 0 | <video src="/kino/previews/animation-slideIn.mp4" muted loop autoplay playsinline width="160"></video> |
| `popIn(duration = 0.4, easing = "easeOut")` | scale 0.8 → 1 | <video src="/kino/previews/animation-popIn.mp4" muted loop autoplay playsinline width="160"></video> |

### `defineComposition(composition)`

Identity function that types a plain object literal as `KinoComposition`:

```typescript
import { defineComposition } from "@glitchoff/kino";

export default defineComposition({
  width: 1080,
  scenes: [{ duration: 5, elements: [{ type: "text", content: "Hi" }] }],
});
```

### `toComposition(input)`

Accepts a builder or a plain object and always returns a `KinoComposition`
(calling `.build()` when needed).

### `exportComposition(composition, options)`

Exports a composition in whichever forms you ask for. Each output is
independent, so asking for stills never encodes a video.

```typescript
import { composition, exportComposition } from "@glitchoff/kino";

const { frames, video, preview } = await exportComposition(comp, {
  frames: [0, 1.5, { at: 3, name: "title" }],  // stills, by seek
  video: "out.mp4",                             // full quality
  preview: 144,                                 // 144p, `previewOutput` names it
});
```

| Option | Type | Description |
| --- | --- | --- |
| `video` | `string` | Output path for the full-quality render |
| `preview` | `boolean \| number` | Fast downscaled render, by height |
| `previewOutput` | `string` | Preview path. Default `preview.mp4` |
| `frames` | `(number \| { at, name?, format? })[]` | Stills to write |
| `frameDir` | `string` | Where stills go. Default the working directory |

Returns `{ video?, preview?, frames? }` — only what you asked for.

Each still comes back as `{ at, path, data }`. `data` is a
`data:image/png;base64,…` URL, ready to pass to a vision model or an upload
without reading the file again.

**Stills are cheap.** A frame costs a seek, not a render: on a 20-second
640×360 composition, one frame took ~75–190 ms against ~1.1 s for the video.
The cost is compiling, not seeking, so ask for several timestamps in one call
rather than calling repeatedly.

`frames` needs a composition, not a `.kino` path — a compiled artifact cannot be
seeked by scene.

---

## Captions

### `captions(source, options?)`

Turns a measured line or `WordTiming[]` into timed caption elements. Returns
`TextElement[]` using `drawtext`, with `karaoke` as the default style.

### `captionsAsync(source, options?)`

Same, but aligns words to real audio first when the optional aligner is
installed, and falls back to even timing when it is not.

### `captionImages(timings, options)`

Word-level karaoke as pre-rendered images. Returns `ImageElement[]`, one per
word, timed to that word's span. Use this instead of `style: "karaoke"` when the
caption track is long: `karaoke` re-renders the line for every word, which
stalls past roughly six lines, while swapping images costs the same per frame
regardless of word count.

```typescript
import { captionImages } from "@glitchoff/kino";

const frames = await captionImages(timings, {
  width: 2560, height: 280,
  displayWidth: 1280, displayHeight: 140,
  dir: "/tmp/karaoke-frames",
  fontSize: 132,
  wordsPerLine: 5,
  color: "#ffffff",
  highlight: "#f5b544",
});
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `width` | `number` | — | PNG width. Rasterise at 2x the display size for crisp text |
| `height` | `number` | — | PNG height |
| `displayWidth` | `number` | `width` | On-screen width |
| `displayHeight` | `number` | `height` | On-screen height |
| `dir` | `string` | — | Where the PNGs are written |
| `fontFile` | `string` | system font | Font used to draw the line |
| `ffmpegPath` | `string` | bundled ffmpeg | Binary used to rasterise |
| `x` | `number` | `0` | Strip position on the frame |
| `y` | `number` | `0` | Strip position on the frame |

Also accepts the `CaptionOptions` shared with `captions()`: `wordsPerLine`
(4), `fontSize` (56), `color` (`#f8fafc`), `highlight` (`#38bdf8`), `hold`,
`zIndex`, `at`.

Pass every timing at once. Lines are grouped and each line's hold is trimmed
against the following line, so calling this per line stacks captions on screen.

---

## `compile(composition, options?)`

Compiles a `KinoComposition` object into a portable **`.kino` artifact** (a zip archive) containing the full FFmpeg command, all text files, and every asset file the composition references — using relative paths only.

Any `http(s)` asset or font URLs referenced by the composition (backgrounds, image/video elements, `fontFile`, audio tracks) are **downloaded at compile time** into the archive (their MIME type determines the staged extension). Local paths are copied in as-is. The resulting artifact is fully self-contained and renders **offline**, with no network access at render time. If `encoder` is omitted or `"auto"`, `compile()` probes the host ffmpeg binary and selects the best available GPU encoder (NVENC → QSV → AMF on Windows, VideoToolbox on macOS, NVENC → QSV → VAAPI on Linux), falling back to `libx264` if none works.

### Signature
```typescript
function compile(
  composition: KinoComposition,
  options?: Partial<RenderOptions>
): CompileResult
```

### Return Value (`CompileResult`)
- `kinoFilePath: string` — Path to the written `.kino` artifact. Defaults to `<output>.kino` (e.g. `out.mp4` → `out.kino`) unless `options.kinoPath` is set.
- `args: string[]` — The portable FFmpeg argument array stored in the artifact (relative paths; the final output element is a portable placeholder filename).
- `filtergraph?: string` — Generated FFmpeg filter complex string.

`compile()` has a filesystem side effect: it creates an ephemeral staging directory, zips it into the `.kino` file, and removes the staging directory — including when it throws partway through.

---

## The `.kino` Artifact Format

A `.kino` file is a self-contained zip archive:

```
manifest.json       — { ffmpegArgs: string[], output: string, kinoVersion: string }
text-1.txt, ...     — one file per text element (verbatim UTF-8 content)
asset-1.<ext>, ...  — local image/video/audio/font assets referenced by the composition
remote-1.<ext>, ... — remote http(s) assets downloaded into the archive at compile time (extension from Content-Type)
```

- **Relative paths only.** All `textfile=` and `-i` references inside `manifest.json` are relative filenames (e.g. `text-1.txt`, `asset-1.jpg`, `remote-1.jpg`). No absolute paths, temp-dir names, machine-specific strings, or live URLs live inside the archive, so a `.kino` can be copied across machines and OSes and re-rendered as-is — and renders never touch the network.
- `manifest.ffmpegArgs` ends with a portable output placeholder (e.g. `out.mp4`); `render()` substitutes the real destination when spawning.

### Text Delivery

Text elements are delivered to drawtext via a **textfile** (`textfile='text-N.txt'`) baked into the `.kino` archive. This avoids all drawtext escaping pitfalls — apostrophes, colons, backslashes, and newlines are passed through verbatim and survive platform changes. Only `unsafeInlineText` reverts to inline `text=` delivery.

---

## `render(compositionOrKinoPath, options)`

Accepts either a `KinoComposition` object (compiles it to a `.kino` first) or a path to an existing `.kino` file (extracts and renders without recompiling). Extracts the artifact to a fresh temp directory, spawns `ffmpeg` with that directory as the child process's **cwd** (so the relative paths resolve with zero rewriting), and cleans up afterward. Automatically falls back to CPU `libx264` if a requested GPU hardware encoder is unavailable.

### Signature
```typescript
async function render(
  compositionOrKinoPath: KinoComposition | string,
  options: RenderOptions
): Promise<{ output: string }>
```

### `RenderOptions`
- `output: string` — Output video file path (e.g., `./out.mp4`).
- `encoder?: VideoEncoder` — Target video encoder (`"libx264"`, `"h264_nvenc"`, `"hevc_nvenc"`, `"h264_qsv"`, `"h264_amf"`, `"h264_videotoolbox"`, or `"auto"`). Defaults to `"auto"`. With `"auto"`, Kino probes the host's ffmpeg binary and hardware (NVENC → QSV → AMF on Windows, VideoToolbox on macOS, NVENC → QSV → VAAPI on Linux) and picks the first GPU encoder that actually works, falling back to `"libx264"` if none does.
- `preset?: string` — Encoder speed/quality preset. Presets are validated per encoder: NVENC accepts `p1`–`p7` (defaults to `"p2"` when unset or when given an x264-only name like `"veryfast"`), AMF maps to `"speed"`/`"balanced"`/`"quality"` (default `"speed"`), QSV and `libx264` accept x264-style presets (`"veryfast"`, `"ultrafast"`, `"medium"`, `"slow"`, …; default `"veryfast"`), VideoToolbox ignores it.
- `ffmpegPath?: string` — Custom path to `ffmpeg` binary. Defaults to system `ffmpeg`, the bundled drawtext-enabled Linux build, or bundled `ffmpeg-static`. Run `npx kino setup ffmpeg` to install or verify the bundled binary manually.
- `verbose?: boolean` — Set to `true` to log FFmpeg command and stream output.
- `kinoPath?: string` — Where `compile()` writes the `.kino` artifact. Defaults to `<output>.kino`.
- `unsafeInlineText?: boolean` — **Dangerous.** When set, text is passed to drawtext inline via the `text=` option instead of a `textfile`, bypassing the `.kino` text mechanism. Text containing apostrophes (or other special characters) may render blank on some platforms with no error. Only use if you cannot write temp files. `render()` prints a warning when enabled.
- `browserPath?: string` — Custom Chrome/Chromium executable path for `HtmlElement` compilation. If omitted, Puppeteer uses its bundled browser or automatically installs Chrome when needed.
- `browser?: "chrome" | "obscura" | "auto"` — Which engine rasterises `HtmlElement`s. Defaults to `"chrome"`. `"obscura"` connects to a running [Obscura](https://docs.obscura.sh/) instance; `"auto"` uses Obscura when one is reachable and Chrome otherwise.
- `browserUrl?: string` — Obscura's CDP endpoint. Defaults to `OBSCURA_URL`, then `http://127.0.0.1:9222`.
- `preview?: boolean | number` — Fast preview mode. `true` downscales the output to 144p; a number sets the height in pixels (width follows the source aspect). The encoder also switches to `ultrafast` unless `preset` is given. Only the **output stage** changes, so the scene graph a preview shows is identical to a full render.
- `assetCache?: boolean` — Cache remote assets on disk, keyed by a SHA-256 of the URL, so re-renders skip the download. Defaults to `true`.
- `assetCacheDir?: string` — Where the asset cache lives. Defaults to `.kino-cache/` in the working directory, falling back to `~/.cache/kino/assets` if that is not writable.

```typescript
// ~2x faster iteration while authoring
await render(video, { output: "./preview.mp4", preview: true });
await render(video, { output: "./preview.mp4", preview: 480 }); // readable text
```

Puppeteer (via `puppeteer-core`) is an optional capability in practice: it is only invoked when the composition contains an `HtmlElement`, and **no browser is downloaded at install time**. The first time such a composition is compiled, Kino downloads Chrome into the shared cache (`~/.cache/puppeteer`) automatically; run `npx kino setup` (or `npx kino setup browser`) to pre-install it ahead of time. Passing `browserPath` uses the given executable directly and disables the automatic download.

After compilation, an `HtmlElement` is an image asset inside the `.kino` archive. Its `startAt` and `duration` are evaluated by FFmpeg during rendering, so the archived artifact remains portable and offline. Position and scale animations work on the generated image layer; opacity animation is currently not supported reliably for HTML layers.

---

## GPU Acceleration & Automatic Fallback

With `encoder: "auto"` (the default), Kino probes the host ffmpeg binary and hardware before compiling, and selects the best available GPU encoder for the machine (NVENC → QSV → AMF on Windows, VideoToolbox on macOS, NVENC → QSV → VAAPI on Linux). If a requested GPU encoder is unavailable or fails mid-render — or no GPU encoder works at all — Kino logs a warning and seamlessly falls back to CPU (`libx264`):

```typescript
await render(composition, {
  output: "./out.mp4",
  encoder: "auto" // picks NVENC on NVIDIA machines, falls back to libx264 on CPU-only machines
});
```

---

## `validateComposition(composition)`

Validates an unknown or untrusted JSON composition before normalization or compilation. Collects all structural, finite number, range, and property errors across scenes, elements, and animations.

```typescript
import { validateComposition, KinoValidationError } from "@glitchoff/kino";

try {
  validateComposition(userComposition);
} catch (error) {
  if (error instanceof KinoValidationError) {
    // Array of structured path-indexed issues: [{ path: "scenes[2].elements[4].width", message: "Expected a positive number, received -500" }]
    console.log(error.issues);
    console.error(error.message); // Human / agent readable formatted string
  }
}
```

---

## Error Handling & Schema Validation

`normalizeComposition()`, `compile()`, and `render()` run `validateComposition()` at the entry of the pipeline (**unknown JSON → validate → normalize → compile → FFmpeg**). Malformed inputs throw `KinoValidationError` immediately with path-indexed issues without spawning FFmpeg:

```typescript
try {
  await render(composition, { output: "./out.mp4" });
} catch (error) {
  if (error instanceof KinoValidationError) {
    console.error("Invalid composition format:", error.issues);
  } else {
    console.error("Render failed:", error.message);
  }
}
```
