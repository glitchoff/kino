# Command line

Kino's CLI renders a composition without writing a script around it. Everything
here is also available programmatically — see the
[API reference](./api-reference.md) — but the CLI is the fastest way to go from
a `.ts` file to an MP4.

```bash
npx kino <file> [options]
```

The input can be:

| Extension | What it is |
| --- | --- |
| `.ts` / `.js` / `.mjs` | A code composition, e.g. `export default composition(...).build()` |
| `.kino` | A pre-compiled artifact, which renders without recompiling |

JSON compositions are **not** supported. Author in code so options are typed,
defaults resolve, and helpers such as `voice()` can be awaited.

## Preview while you work

`preview` serves a live view of a composition in the browser and re-renders when
the source changes. It is the loop you want while tuning type, timing or colour —
a full render per tweak is far too slow to iterate on.

```bash
npx kino preview composition.ts
npx kino preview composition.ts --port 4000
npx kino preview composition.ts --height 480
```

| Flag | Default | What it does |
| --- | --- | --- |
| `-p, --port <number>` | `3333` | Port for the preview server |
| `--height <px>` | `360` | Height of the preview proxy |

`serve` is an alias for `preview`.

There is a second, different "preview": `--preview [height]` on a **render**
downscales the output and switches to the ultrafast preset, so you get a rough
MP4 in a fraction of the time. Use `preview` while composing, `--preview` when
you want a shareable file quickly.

```bash
npx kino composition.ts --preview 144     # rough and fast
```

## Render flags

| Flag | Description |
| --- | --- |
| `-o, --output <path>` | Output file (default `./out.mp4`) |
| `-e, --encoder <name>` | `libx264`, `h264_nvenc`, `hevc_nvenc`, `h264_qsv`, `h264_amf`, `h264_videotoolbox`, `auto` |
| `--preset <name>` | Encoder preset, per-encoder — NVENC `p1`–`p7`, x264 `veryfast`/`slow` |
| `--crf <n>` | Quality, `0`–`51`, lower is better (default `20`) |
| `--gpu` | Alias for `--encoder auto`, with CPU fallback |
| `--scene <id>` | Render one scene only, rebased to zero |
| `--preview [height]` | Fast downscaled preview (default `144`) |
| `--dry-run` | Compile and print the FFmpeg command without rendering |
| `--ffmpeg-path <path>` | Use a specific ffmpeg binary |
| `--browser-path <path>` | Chrome/Chromium executable for HTML elements |
| `--no-asset-cache` | Re-download remote assets |
| `--asset-cache-dir <path>` | Remote asset cache location (default `./.kino-cache`) |
| `--ytdlp` | Allow `yt:` sources via yt-dlp on `PATH` (not bundled) |
| `--ytdlp-cookies <file>` | Netscape cookie jar passed to yt-dlp |
| `--unsafe-inline-text` | Disable textfile delivery (apostrophes may render blank) |
| `--verbose` | Show full FFmpeg logs |
| `-h, --help` | Show help |

`--scene` is the one worth knowing about: rendering a single scene is how you
iterate on one beat without waiting for the whole chapter.

## Setup

Some features need something installed once.

```bash
npx kino setup            # everything
npx kino setup browser    # Chrome, for HTML elements
npx kino setup ffmpeg     # the drawtext-enabled ffmpeg build
npx kino setup tts        # check for Piper
npx kino setup captions   # the optional aligner + its model (~317 MB)
```

`setup captions` installs `mms-forced-align`, which times captions against real
audio instead of spreading words evenly across the line. Captions work without
it — see [Content](./content.md#captions).

The browser is also installed automatically on the first render that contains an
HTML element, so `setup browser` is only needed if you would rather not have that
download happen mid-render.

## A full example

```bash
# Iterate on one beat.
npx kino preview clips/ch01/ch01.ts --height 480

# Check what will actually be run.
npx kino clips/ch01/ch01.ts --dry-run

# Render one scene on the GPU.
npx kino clips/ch01/ch01.ts --scene p04 --gpu -o out/p04.mp4

# Render the chapter.
npx kino clips/ch01/ch01.ts -e h264_nvenc --crf 20 -o out/ch01.mp4
```

---

Next: [Rendering](./rendering.md) covers encoders, quality and how the pipeline
assembles a frame.
