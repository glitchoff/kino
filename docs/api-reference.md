# Programmatic API Reference

Kino exports core compiler and renderer functions for Node.js and TypeScript applications.

```typescript
import { render, compile } from "@glitchoff/kino";
import type { KinoComposition, RenderOptions, CompileResult, VideoEncoder } from "@glitchoff/kino";
```

---

## `compile(composition, options?)`

Compiles a `KinoComposition` object into a portable **`.kino` artifact** (a zip archive) containing the full FFmpeg command, all text files, and every asset file the composition references — using relative paths only.

Any `http(s)` asset or font URLs referenced by the composition (backgrounds, image elements, `fontFile`, audio tracks) are **downloaded at compile time** into the archive (their MIME type determines the staged extension). Local paths are copied in as-is. The resulting artifact is fully self-contained and renders **offline**, with no network access at render time. If `encoder` is omitted or `"auto"`, `compile()` probes the host ffmpeg binary and selects the best available GPU encoder (NVENC → QSV → AMF on Windows, VideoToolbox on macOS, NVENC → QSV → VAAPI on Linux), falling back to `libx264` if none works.

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
- `ffmpegPath?: string` — Custom path to `ffmpeg` binary. Defaults to system `ffmpeg` or bundled `ffmpeg-static`.
- `verbose?: boolean` — Set to `true` to log FFmpeg command and stream output.
- `kinoPath?: string` — Where `compile()` writes the `.kino` artifact. Defaults to `<output>.kino`.
- `unsafeInlineText?: boolean` — **Dangerous.** When set, text is passed to drawtext inline via the `text=` option instead of a `textfile`, bypassing the `.kino` text mechanism. Text containing apostrophes (or other special characters) may render blank on some platforms with no error. Only use if you cannot write temp files. `render()` prints a warning when enabled.

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
