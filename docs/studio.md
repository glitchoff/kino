# Live preview

`serve()` puts a composition in a browser and keeps it there while you edit.

```ts
import { composition, serve } from "@glitchoff/kino";

const video = composition({ width: 1080, height: 1920 })
  .scene({ duration: 5 }, (s) => s.text("Hello", { x: "center", y: "center" }))
  .build();

await serve(video, { port: 3333 });
```

```bash
npx tsx watch my-composition.ts   # edit, save, the page reloads
```

Or from the CLI, against a composition file:

```bash
npx kino preview composition.ts
npx kino preview composition.ts --port 4000 --height 480
```

## Two modes, because they answer different questions

**Seek** scrubs the timeline. The first press renders the composition once to a
small all-keyframe proxy, then decodes that whole proxy into memory as raw
frames. A seek after that is an array lookup: measured **4.75 ms per frame over
HTTP** (211 fps) on a real 21.5 s composition, against 623 ms when each frame
spawned ffmpeg. That 623 ms was almost entirely process startup — on this
machine `ffmpeg -version` alone costs ~640 ms.

Memory is the constraint, so the cache has a budget (`frameCacheMB`, default
512). A 21.5 s clip at 640×360 is ~568 MB and fits entirely; a longer one keeps
the first part resident and seeks the proxy for the rest, which is slower (~17 ms)
rather than broken.

**Play** renders a real mp4 with audio, joined from cached segments. Re-render
after an edit and only the segments that changed are encoded again, so the
second render is much cheaper than the first.

The first interaction in either mode is a full render at proxy size. There is no
way around that: nothing can show you a frame it has not drawn yet. For a real
266 s composition that build is ~580 s at 144p; everything after it is realtime.

## Window the proxy while you iterate

Building the whole timeline to look at one beat is the expensive part, and it is
avoidable. `--start` and `--window` build the proxy for a slice of the timeline
only:

```bash
npx kino preview composition.ts --start 40 --window 4
```

Measured on a 164 s, 56-scene chapter at 360p: **58 s for the whole proxy against
1.7 s for a 4 s window** — 35x to the first frame.

A window is a faithful slice, not an approximation. Every scene's clock starts at
zero (`setpts=PTS-STARTPTS`, scene-relative `startAt`, `enable='between(t,…)'`),
so a scene compiles identically whether it is at the start of a window or in the
middle of the timeline. The window snaps back to the start of the scene
containing `--start`, and trims only the **tail**, so no timing has to be
re-based. Frames from a 4 s window and an 8 s window over the same region are
byte-identical.

A seek past the window clamps to its end rather than failing. Move the window by
restarting with a different `--start`; the segments that did not change are
reused.

From code:

```ts
await serve(video, { startAt: 40, windowSeconds: 4 });
await Preview.open(video, { startAt: 40, windowSeconds: 4 });
```

## HMR

`serve()` writes a boot id on start, and the page polls it. When the id changes
the page reloads. Under a watcher that restarts the process — `tsx watch`,
`node --watch`, `nodemon` — that means a source change reaches the browser
without a manual refresh.

The composition is rebuilt when the process restarts, so what you see is always
what the file says.

Pass `reload: false` to turn the poll off, which is what you want behind a
reverse proxy or when you drive the page yourself.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `port` | `3333` | First port tried; the next 20 are used if it is taken |
| `height` | `360` | Height of the seek proxy |
| `frameCacheMB` | `512` | RAM budget for decoded frames; `0` disables the cache |
| `dir` | `.kino-serve` | Where the proxy and segment cache live |
| `reload` | `true` | Poll for a restart and reload the page |
| `encoder`, `crf`, `preset` | — | Passed through to the render |

Sizing the cache: one frame is `width × height × 4` bytes. At `height: 360` a
16:9 proxy is 640×360, so a frame is 921 KB and 512 MB holds ~568 frames —
about 19 s at 30 fps. Raise it if the clip is short and you want the whole thing
resident; a 21.5 s clip needs ~640 MB.

`serve()` resolves to a handle:

```ts
const handle = await serve(video, { port: 3333 });
console.log(handle.url);   // http://localhost:3333
await handle.close();      // stops the server, frees the proxy
```

## What it is not

No editor, no file tree, no project management. It serves one composition and
shows it. Editing happens in your editor, which already has syntax highlighting,
go-to-definition and everything else a text box in a browser would have to
reinvent.
