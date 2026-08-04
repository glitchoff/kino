# Kino

A TypeScript library, CLI, and local web studio for compiling JSON scene compositions into MP4 videos via FFmpeg.

- **Declarative** — describe scenes, elements (text / image / html / video), and audio as JSON.
- **Rich scenes** — 11 built-in transitions, per-element animations, reusable templates, and z-index layering.
- **Fast by default** — GPU hardware encoding with automatic CPU fallback.
- **Portable** — compile to a self-contained `.kino` artifact and render offline anywhere.

## Installation

```bash
pnpm add @glitchoff/kino   # or: npm install @glitchoff/kino
```

Nothing is downloaded at install time. FFmpeg is bundled with the package (drawtext-enabled on Linux). A browser is only needed for `html` elements — Kino downloads Chrome lazily on first use, or you can pre-install it with `npx kino setup`. Use `--browser-path` to point at an existing Chrome instead.

## Usage

```typescript
import { render } from "@glitchoff/kino";

await render(
  {
    width: 1080,
    height: 1920,
    fps: 30,
    scenes: [
      {
        duration: 5,
        background: "#0f172a",
        elements: [
          {
            type: "text",
            content: "Hello Kino",
            fontSize: 72,
            fontColor: "white",
            x: "center",
            y: "center"
          }
        ]
      }
    ]
  },
  { output: "./out.mp4" }
);
```

CLI:

```bash
npx kino scene.json -o out.mp4    # render JSON to MP4
npx kino scene.json --dry-run      # compile to a .kino artifact, print the ffmpeg command
npx kino studio                    # open the visual editor
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
