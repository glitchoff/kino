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

Saved lines persist in `.kino/showcase/showcase.db`. Session history of rendered
clips is in memory only. Engine and voice lists are declared in `index.ts` — kino
itself knows nothing about which voices exist, because every engine names its own.

Engines come in two shapes: a `command` engine spawns a script, an `http` engine
POSTs to a server. Pocket TTS uses the HTTP path, so no adapter file has to live
in the composition's project.

| helper | what |
| --- | --- |
| `verify-page.mjs` | parses and runs the served page — catches a broken script |
| `verify.mjs` | exercises the DB routes: save/delete a line, toggle a pick |
| `diff-voices.mjs` | compares the showcase's voice list with the server's catalog |

## Starting the servers

**These must outlive the shell that started them.** Running them as a background
job means they die when the job's timeout expires, which has silently killed the
preview mid-session more than once. Use the `.cmd` scripts and leave the window
open:

| script | serves |
| --- | --- |
| `scripts/preview/start-preview.cmd` | the chapter at :8000 |
| `scripts/showcase/start-pocket.cmd` | Pocket TTS at :8200 |
| `scripts/showcase/start-showcase.cmd` | the showcase at :4100 |

Start Pocket before the showcase — the showcase calls it.

## probe/

Measurements kept because they answer a question again later.

| file | question |
| --- | --- |
| `proxy.mjs` | does the proxy path serve every frame at every timestamp? |
| `videoonly.ts` | does the audio-pruned graph still produce frames? |
| `serve-file.mjs` | range-serving a file, to watch a render still being written |
