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
| `--preview [height]` | Downscaled render — composites at that height, not full size |
| `--crf <n>` | Encoder quality, 0–51, lower is better. Default 20 |
| `--preset <name>` | Encoder preset (x264, NVENC p1–p7, …) |
| `--scene <n>` | Render one scene |
| `--ffmpeg-path <path>` | Override the ffmpeg binary |
| `--browser <engine>` | `chrome`, `obscura`, or `auto` for `html` elements |
| `--browser-url <url>` | CDP endpoint for Obscura |
| `--asset-cache [dir]` | Cache downloaded assets |
| `--ytdlp` | Allow `yt:` sources |
| `--verbose` | Show the ffmpeg command and its output |

**`--preview` composites at the preview size.** Backgrounds, images, text and
overlays are all built for the smaller frame, so the work per frame scales down
with the resolution. Earlier versions did full-resolution work and downscaled at
the very end, which made a 144p preview cost as much as a 1080p render.

The scene graph is unchanged — same elements, same order, same timing, same
grade — so a preview shows what the full render will, at a lower pixel grid.
Fine detail (a 1.5px stroke, a sub-pixel text offset) can round differently.

## Incremental renders

```typescript
await render(comp, { output: "out.mp4", cache: true });
// second run after editing one scene:
// [kino] cached render: 1 segment(s) reused, 2 rendered
```

`cache: true` renders each scene as its own segment, keyed by a hash of that
scene's content, and joins the segments with `-f concat -c copy`. Re-running
after an edit re-encodes only the segments that changed.

**A transition makes a scene and its neighbour one unit.** A fade draws from
both scenes, so segment N renders scenes N-1 and N together and keeps only the
slice it owns. Editing scene N therefore invalidates segment N and segment N+1 —
never the whole timeline. Segments own abutting slices `[start_i, start_{i+1})`,
so the join reproduces the timeline exactly.

Costs:

- A **one-shot render is slower** with the cache — one ffmpeg run per segment
  plus a concat pass. It pays off from the second render onward.
- Not compatible with `preview`, which composites at a smaller frame.
- The cache never garbage-collects. It lives in `cacheDir` (default
  `.kino-cache/` beside the output); delete that directory to reclaim space.

`render()` returns `{ output, reused, rendered }` so a caller can report what
was skipped.

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