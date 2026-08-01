# Programmatic API Reference

Kino exports core compiler and renderer functions for Node.js and TypeScript applications.

```typescript
import { render, compile } from "kino";
import type { KinoComposition, RenderOptions, CompileResult, VideoEncoder } from "kino";
```

---

## `compile(composition, options?)`

Compiles a `KinoComposition` object into raw FFmpeg command line arguments and filtergraphs without running `ffmpeg`.

### Signature
```typescript
function compile(
  composition: KinoComposition,
  options?: Partial<RenderOptions>
): CompileResult
```

### Return Value (`CompileResult`)
- `args: string[]` — FFmpeg command arguments array (e.g. `["-y", "-f", "lavfi", ...]`).
- `filtergraph?: string` — Generated FFmpeg filter complex string.

---

## `render(composition, options)`

Compiles the composition and spawns `ffmpeg` to render the output video file. Automatically falls back to CPU `libx264` if a requested GPU hardware encoder is unavailable.

### Signature
```typescript
async function render(
  composition: KinoComposition,
  options: RenderOptions
): Promise<{ output: string }>
```

### `RenderOptions`
- `output: string` — Output video file path (e.g., `./out.mp4`).
- `encoder?: VideoEncoder` — Target video encoder (`"libx264"`, `"h264_nvenc"`, `"hevc_nvenc"`, `"h264_qsv"`, `"h264_amf"`, `"h264_videotoolbox"`, or `"auto"`). Defaults to `"libx264"`.
- `preset?: string` — Encoder speed/quality preset (e.g. `"veryfast"`, `"ultrafast"`, `"medium"`, `"slow"`, or `"p2"` for NVENC). Defaults to `"veryfast"` (CPU) / `"p2"` (GPU) for maximum rendering speed.
- `ffmpegPath?: string` — Custom path to `ffmpeg` binary. Defaults to system `ffmpeg` or bundled `ffmpeg-static`.
- `verbose?: boolean` — Set to `true` to log FFmpeg command and stream output.

---

## GPU Acceleration & Automatic Fallback

When `encoder` is set to a GPU encoder (`"h264_nvenc"`, `"auto"`, etc.), Kino attempts hardware-accelerated rendering first. If the host machine lacks GPU drivers or hardware support, Kino catches the process failure, logs a warning, and seamlessly falls back to CPU (`libx264`):

```typescript
await render(composition, {
  output: "./out.mp4",
  encoder: "h264_nvenc" // Uses NVENC on NVIDIA GPUs, falls back to libx264 on CPU-only machines
});
```

---

## Error Handling

`render()` rejects with a descriptive Error if the `ffmpeg` process fails and no fallback is possible:

```typescript
try {
  await render(composition, { output: "./out.mp4" });
} catch (error) {
  console.error("Render failed:", error.message);
}
```
