# Kino

A scripting-first video engine. Write compositions in TypeScript, render them to MP4 via FFmpeg.

- **Scripting-first** — describe scenes, elements (text / image / html / video), and audio in code, with types, loops and computed values.
- **Rich scenes** — 11 built-in transitions, per-element animations, reusable templates, and z-index layering.
- **Fast by default** — GPU hardware encoding with automatic CPU fallback.
- **Portable** — compile to a self-contained `.kino` artifact and render offline anywhere.

> JSON compositions are still accepted everywhere and remain supported, but new
> work targets the scripting API. See [Code Compositions](./docs/getting-started.md#-code-compositions).

## Installation

```bash
pnpm add @glitchoff/kino   # or: npm install @glitchoff/kino
```

Nothing is downloaded at install time. FFmpeg is bundled with the package (drawtext-enabled on Linux). A browser is only needed for `html` elements — Kino downloads Chrome lazily on first use, or you can pre-install it with `npx kino setup`. Use `--browser-path` to point at an existing Chrome instead.

## Usage

```typescript
import { composition, fadeIn, render } from "@glitchoff/kino";

const video = composition({ width: 1080, height: 1920, fps: 30 })
  .scene({ duration: 5, background: "#0f172a" }, (s) =>
    s.text("Hello Kino", {
      fontSize: 72,
      color: "white",
      x: "center",
      y: "center",
      animation: { opacity: fadeIn(0.6) },
    })
  )
  .build();

await render(video, { output: "./out.mp4" });
```

CLI:

```bash
npx kino scene.ts -o out.mp4      # render a code composition
npx kino scene.json -o out.mp4    # JSON still works
npx kino scene.ts --dry-run       # compile to a .kino artifact, print the ffmpeg command
npx kino studio                   # open the visual editor
npx kino setup                     # pre-download Chrome for html elements
```

## Documentation

- [Getting Started](./docs/getting-started.md)
- [Schema Reference](./docs/schema-reference.md)
- [API Reference](./docs/api-reference.md)
- [Kino Studio Guide](./docs/studio.md)

## Docs site

The documentation is also published as a static landing page, served from a separate Cloudflare Worker deployed from the `site/` folder (isolated from this package's build and npm publish).

```bash
cd site
pnpm install     # one-time setup (isolated workspace)
pnpm dev         # local preview at http://localhost:5173
pnpm build       # produce ./site/dist
pnpm deploy      # publish to the kino-site Worker (requires `wrangler`)
```

To wire it up for the first time in Cloudflare: create a Worker (`kino-site`) in the dashboard, then **Settings → Builds → Connect** your GitHub repo and set:

- **Root directory:** `site`
- **Build command:** `pnpm build`
- **Deploy command:** leave default (`npx wrangler deploy`)

The Worker name here must match the `name` field in `site/wrangler.jsonc`, and `site/` ships under its own `pnpm-lock.yaml` so it never pulls the library's dependencies.

## License

MIT
