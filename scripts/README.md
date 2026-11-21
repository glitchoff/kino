# scripts

Helper programs that are **not** part of the published package. Nothing here is
imported by `src/`; these are run by hand or by CI.

| folder | what |
| --- | --- |
| `preview/` | preview harnesses for real compositions (see below) |
| `showcase/` | the voice audition server |
| `probe/` | one-off measurement and debugging probes |
| `install-*.mjs` | fetch ffmpeg, a browser, obscura |
| `telegram-*.mjs` | render notification and upload |

## preview/

Each harness reads a composition from `D:/Projects/Misc/paper-ghost`, writes
nothing into it, and serves a preview.

```sh
npx tsx scripts/preview/chapter.ts        # the 70-scene chapter, proxy at 360p
npx tsx scripts/preview/ghost.ts          # the approved opening
npx tsx scripts/preview/chapter-live.ts   # DEPRECATED: live mode, never worked
```

They import from `dist/`, so **run `pnpm build` first** after changing `src/`.
That has caught every session at least once.

## showcase/

A voice audition server: any line, any engine, any voice, rendered on demand.

```sh
npx tsx scripts/showcase/index.ts   # http://localhost:4100
```

Saved lines and shortlisted voices persist in `.kino/showcase/`. Engine and
voice lists are declared in `index.ts` — kino itself knows nothing about which
voices exist, because every engine names its own.

## probe/

Measurements kept because they answer a question again later.

| file | question |
| --- | --- |
| `proxy.mjs` | does the proxy path serve every frame at every timestamp? |
| `videoonly.ts` | does the audio-pruned graph still produce frames? |
| `serve-file.mjs` | range-serving a file, to watch a render still being written |
