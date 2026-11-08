# Rendering

The CLI and the `render()` function call the same code. Neither is required by
the other — pick whichever fits how you work.

## The CLI

```bash
npx kino composition.ts -o out.mp4
npx kino composition.ts --dry-run          # print the ffmpeg command
npx kino composition.ts --preview          # fast 144p render
npx kino composition.ts --crf 18           # higher quality (default 20)
npx kino composition.ts --scene 2          # one scene only
npx kino out.kino -o out.mp4               # a pre-compiled artifact
```

| Flag | Purpose |
| --- | --- |
| `-o, --output <path>` | Where the video goes |
| `--dry-run` | Print the ffmpeg command and exit |
| `--preview [height]` | Fast downscaled render |
| `--crf <n>` | Encoder quality, 0–51, lower is better. Default 20 |
| `--preset <name>` | Encoder preset (x264, NVENC p1–p7, …) |
| `--scene <n>` | Render one scene |
| `--ffmpeg-path <path>` | Override the ffmpeg binary |
| `--browser <engine>` | `chrome`, `obscura`, or `auto` for `html` elements |
| `--browser-url <url>` | CDP endpoint for Obscura |
| `--asset-cache [dir]` | Cache downloaded assets |
| `--ytdlp` | Allow `yt:` sources |
| `--verbose` | Show the ffmpeg command and its output |

## From code

```typescript
import { render, exportComposition } from "@glitchoff/kino";

await render(comp, { output: "out.mp4" });

// Or take what you need — each output is independent
const { frames, video, preview } = await exportComposition(comp, {
  frames: [0, 1.5, { at: 3, name: "title" }],
  video: "out.mp4",
  preview: 144,
});
```

Stills are cheap — a frame costs a seek, not a render. Each comes back as
`{ at, path, data }` with `data` a `data:image/png;base64,…` URL.

## Hardware acceleration

`encoder: "auto"` probes the machine and picks the best available GPU encoder
(NVENC, QSV, AMF, VideoToolbox, VAAPI), falling back to `libx264`.

## Browsers for `html` elements

| `--browser` | Behaviour |
| --- | --- |
| `chrome` (default) | Chrome or Chromium via Puppeteer |
| `obscura` | Connect to a running [Obscura](https://docs.obscura.sh/) over CDP |
| `auto` | Obscura when one is reachable, Chrome otherwise |

`npx kino setup obscura` installs one locally. Obscura speaks the Chrome DevTools
Protocol, so the page code is unchanged; kino connects and disconnects rather
than launching, so a render never kills your instance.

Remember that `s.tak()` needs none of this.

---