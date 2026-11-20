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
small all-keyframe proxy, then every frame after that is a seek into it — around
23 ms, flat, regardless of where in the clip you land. It is the mode that feels
like an editor.

**Play** renders a real mp4 with audio, joined from cached segments. Re-render
after an edit and only the segments that changed are encoded again, so the
second render is much cheaper than the first.

The first interaction in either mode is a full render at proxy size. There is no
way around that: nothing can show you a frame it has not drawn yet.

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
| `dir` | `.kino-serve` | Where the proxy and segment cache live |
| `reload` | `true` | Poll for a restart and reload the page |
| `encoder`, `crf`, `preset` | — | Passed through to the render |

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
