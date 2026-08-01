# Programmatic API Reference

Kino exports core compiler and renderer functions for Node.js and TypeScript applications.

```typescript
import { render, compile } from "kino";
import type { KinoComposition, RenderOptions, CompileResult } from "kino";
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
- `filtergraph?: string` — Generated FFmpeg `-vf` filter complex string.

---

## `render(composition, options)`

Compiles the composition and spawns `ffmpeg` to render the output video file. Returns a Promise resolving upon successful completion.

### Signature
```typescript
async function render(
  composition: KinoComposition,
  options: RenderOptions
): Promise<{ output: string }>
```

### `RenderOptions`
- `output: string` — Output video file path (e.g., `./out.mp4`).
- `ffmpegPath?: string` — Custom path to `ffmpeg` binary. If omitted, automatically resolves system `ffmpeg` or `ffmpeg-static`.
- `verbose?: boolean` — Set to `true` to log FFmpeg spawn command and stream FFmpeg log output to stdout/stderr.

---

## Error Handling

`render()` rejects with a descriptive Error if `ffmpeg` process fails or exits with a non-zero status code:

```typescript
try {
  await render(composition, { output: "./out.mp4" });
} catch (error) {
  console.error("Render failed:", error.message);
}
```
