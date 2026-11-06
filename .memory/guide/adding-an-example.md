# Adding an example

Examples live in `examples/` and are rendered by the CLI:

```bash
node dist/cli.js examples/basic.json -o out/render.mp4 --ffmpeg-path "$(node scripts/install-ffmpeg.mjs --print-path)"
```

## Steps

1. Create `examples/<name>.json` with a `scenes` array (see `examples/basic.json`
   for a minimal composition).
2. Verify it compiles without rendering:
   ```bash
   node dist/cli.js examples/<name>.json --dry-run
   ```
3. Render it and check the output.
4. **Expose it to the manual workflow** — `examples/` is not globbed. Add the path
   to the `example` choice list in `.github/workflows/telegram-render.yml`:
   ```yaml
   options:
     - examples/basic.json
     - examples/<name>.json   # <- add here
   ```
   `workflow_dispatch` choice inputs are a static list, so a file that is not
   listed cannot be picked from the GitHub UI.

## Conventions

- Keep remote assets on stable URLs (the render downloads them at compile time).
- Prefer `duration` in seconds; unit strings (`"500ms"`, `"50%"`) are also accepted.
- Text needs `drawtext` support — the bundled Linux FFmpeg has it, `ffmpeg-static`
  on Linux does not.
