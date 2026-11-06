# Adding an example

Examples live in `examples/` as TypeScript modules and are rendered by the CLI:

```bash
node dist/cli.js examples/basic.ts -o out/render.mp4 --ffmpeg-path "$(node scripts/install-ffmpeg.mjs --print-path)"
```

## Steps

1. Create `examples/<name>.ts` exporting a composition:
   ```ts
   import { composition, text } from "@glitchoff/kino";

   export default composition({ width: 1080, height: 1920 })
     .scene({ duration: 5, background: "#0f172a" }, (s) =>
       s.text("Hello", { fontSize: 84, color: "#fff", x: "center", y: "center" })
     )
     .build();
   ```
2. Verify it compiles without rendering:
   ```bash
   node dist/cli.js examples/<name>.ts --dry-run
   ```
3. Render it and check the output.
4. **Expose it to the manual workflow** — `examples/` is not globbed. Add the path
   to the `example` choice list in `.github/workflows/telegram-render.yml`:
   ```yaml
   options:
     - examples/basic.ts
     - examples/<name>.ts   # <- add here
   ```
   `workflow_dispatch` choice inputs are a static list, so a file that is not
   listed cannot be picked from the GitHub UI.

## Converting an existing JSON composition

```bash
node scripts/json-to-ts.mjs legacy.json            # writes legacy.ts next to it
node scripts/json-to-ts.mjs examples/*.json --out-dir examples/
```

The converter uses the builder for elements it can express and falls back to
`s.add({...})` for template references and unusual shapes. Review the output —
it is source now.

## Conventions

- Keep remote assets on stable URLs (the render downloads them at compile time).
- Prefer `duration` in seconds; unit strings (`"500ms"`, `"50%"`) are also accepted.
- Text needs `drawtext` support — the bundled Linux FFmpeg has it, `ffmpeg-static`
  on Linux does not.
