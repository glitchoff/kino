# Changelog — session 2026-11-21

Live preview, the frame cache, and a caption spacing fix. Newest last.

Each entry says what shipped, the measured effect, and whether it is committed.

---

## 1. `serve()` — a preview server in the package — **committed `d8ab559`**

```ts
import { composition, serve } from "@glitchoff/kino";
await serve(video);           // http://localhost:3333
```

Routes:

| path | what |
| --- | --- |
| `/` | the preview player |
| `/render` | the final render, separate path and page |
| `/api/proxy` | builds the seek proxy + warms the frame cache |
| `/api/proxy.mp4` | the proxy as a playable mp4, with range support |
| `/api/frame?raw=1&t=` | one frame as raw rgba |
| `/api/render` | produces the deliverable |

Deletes `studio/` (React + Vite + Monaco, untouched since August) and its
dependencies. Adds `kino preview <file>`.

**Trap hit twice:** `@glitchoff/kino` resolves to `dist/`, so an export added to
`src/` does not exist for a composition file until `pnpm build`. First `serve`
wasn't exported; then an edited page string kept serving the old text.

---

## 2. Realtime scrubbing via an in-memory frame cache — **committed `1f63dc1`**

**The finding that mattered:** one frame cost 623 ms, and it was almost entirely
process spawn. Measured on a 640×360 proxy:

| shape | cost |
| --- | --- |
| spawn per frame (the old `Preview.frame`) | **623 ms** |
| `ffmpeg -version` alone, no decode | **641 ms** |
| 30 frames in one process | 531 ms total (**17.7 ms/frame**) |
| decode the whole proxy once | **0.0004 ms/frame** |

A process spawn on this machine costs more than decoding 30 frames. Asking
ffmpeg again per frame *was* the entire expense.

So: decode the proxy once into raw rgba, serve frames from memory.

| | before | after |
| --- | --- | --- |
| per frame | 623 ms | **4.75 ms** |
| fps | 1.5 | **211** |

Measured over HTTP against the real 21.5 s Paper Ghost opening, 120 random
seeks: p50 3.62 ms, p95 11.28 ms. 646/646 frames resident in 568 MB.

A first attempt cached frames but still encoded each to JPEG — **662 ms, no
gain at all**, because the encode was another spawn. The win only arrived when
ffmpeg left the per-frame path entirely.

**Also:** `frameCacheMB` was declared on `ServeOptions` but never threaded
through, so setting it did nothing.

---

## 3. Panels render in the right place in preview — **committed `1f63dc1`**

An element with a scale animation emitted `scale=iw*<expr>` straight onto the
raw input, so the fit/downscale filter was never applied. `iw` is the *source*
size, so an 870 px panel went into a 640 px preview frame undownscaled and hung
off the right edge. Nearly every panel in a real composition is animated, so
this hit all of them.

The target size is now applied before the animated scale.

**Verified by pixel bounding box**, not by eye: 2 px worst edge error at
640×360 (`minX 172 / maxX 466 / minY 0 / maxY 293` against an expected
`172 / 467 / 0 / 295`).

Second half of the same bug: `previewScale` was applied to the scale filter but
not to the overlay position, so a panel was drawn at the right size in the wrong
place. One `previewMedia` value now feeds scale, position, animation and the
still-window trim.

---

## 4. Narrated compositions can preview at all — **committed `1f63dc1`**

`Preview.open` never resolved TTS, while `render()` did. A raw
`{ __kinoTts: true, text, options }` spec reached `compile()` and
`prestageRemoteAssets` called `.startsWith()` on it:

```
TypeError: src.startsWith is not a function
```

Every `voice()` composition failed to preview. `Preview.open` now resolves TTS
first, exactly as `render()` does, and `isRemote` tolerates a non-string `src`.

---

## 5. Caption spacing and baseline — **NOT COMMITTED**

Two separate bugs, both in `reveal`, which used to emit **one element per word**:

**Gaps.** Each word's x came from `estimateTextWidth`, a character-class table
that prices lowercase at 0.52em where the font draws closer to 0.25em:

| word | estimated | drawn |
| --- | --- | --- |
| `you` | 72 px | ~35 px |
| `have` | 96 px | ~48 px |
| space | 14 px | 27 px |

That estimate *is* the advance, so the error became a gap — and because each
word's error differed, the gaps were uneven too. In a rendered line: 15, 40 and
14 px between words, where one value was needed. A line read `Whathas`.

**Baseline.** `bottom-N` compiles to `h - text_h - N`, and `text_h` is *that
element's* height. With one element per word, a word with an ascender (`have`)
is taller than one without (`you`), so each word sat on its own baseline and the
words visibly stepped up and down. That is what read as "inconsistent font
size" — the size was never different.

**Fix:** a line is now **one element**, holding the full text at one position,
with per-word timings driving the highlight through the existing `captionWords`
machinery. One `text_h`, so the baseline cannot drift; the font lays out the
words itself, so there is no advance to estimate.

Verified in a rendered frame:

| | word gaps | baseline spread |
| --- | --- | --- |
| before | 15, 40, 14 | 9 px (words stepping) |
| after | **16, 18, 14, 19** | **0 px** |

Letter gaps stay 2–5 px. It is also faster: one drawtext per line instead of
two per word, and no measuring.

**A wrong turn worth recording.** The first fix kept one element per word and
measured real glyph widths with ffmpeg — batched into one call per line, ~700 ms
each. It produced correct gaps (24/35/69/30 px) and 40/40 tests passed, but it
took **411 s** to run the caption suite and it never fixed the baseline, because
per-word elements still each got their own `text_h`. Measuring was the wrong
direction: the font already knows its own glyph widths, so the answer was to let
it lay out the line. `src/captions/measure-batch.ts` was deleted.

**Status:** built and measured, not yet committed or run through the full suite.


---

## 6. Live compositing — **built, never worked, abandoned**

The goal was a preview with no proxy build: composite each frame on demand
instead of exporting 144p first. The graph half worked. The serving half never
did.

**What was proven.** `src/pipeline/video-only.ts` prunes audio chains from a
compiled filtergraph — 1,838 of 2,057 chains kept on the 70-scene chapter. Two
pruning bugs were fixed on the way; the first dropped 141 pads still in use
because it treated ffmpeg source pads as needing a producer. With the corrected
graph, a standalone ffmpeg run produced **120 correct frames, exit 0**, at
**~67 ms/frame** (first frame 10.5–14.5 s) on chapter.mts at 144p.

**What never worked.** The HTTP frame path. Four bugs in sequence, each fix
exposing the next:

1. **Listener leak** — `once("data")`/`once("end")`/`once("error")` added per
   read. A 144p frame is 147 KB across several 64 KB chunks, so handlers piled
   up until `MaxListenersExceededWarning: 11 data listeners on Socket` and the
   socket died with ECONNRESET.
2. **Consumed frames never re-served** — a repeat request waited for a frame
   already handed out and deleted, then failed with
   `live renderer ended at frame 5351 before 300`.
3. **Skip loop outrunning the target** — pruning `key < index` after the target
   was already buffered dropped the frame it wanted.
4. **Then every request returned 500**, undiagnosed.

`/api/proxy` reported `live: true`, build 0 ms, no cache — correct — while
`/api/frame` returned 500s. The user's verdict: "not working".

**Why.** The proven probe was stateless: spawn, read N frames, exit. The class
added buffering, skipping, restarting and a served-frame cache — four
interacting state machines written in one pass and tested only at the end.
`live-renderer.ts` is now the stateless shape (spawn per request, keep the last
frame, exit), which is correct but pays the ~640 ms spawn per request and has to
evaluate every frame before the target because the graph has no seekable input.

**Decision.** `live` stays an option, default **false**. The proxy path is the
recommended one and the one this session ends on: build a 144p/360p proxy, then
0.5–5 ms per frame. Its cost is time-to-first-frame, not per-frame — which is
why the **segment cache** is the next thing to build, not another live renderer.

See `.memory/findings-live-render.md`.

**Status:** uncommitted. `preview-chapter-live.ts` marked deprecated;
`preview-chapter.ts` (proxy, 360p) is the harness.


---

## 7. `yt-dlp` installed and put on PATH — **environment, not a commit**

`pip install yt-dlp` landed **2026.10.26** in the Store-Python user site:

```
...\Packages\PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0\
  LocalCache\local-packages\Python313\Scripts\yt-dlp.exe
```

That path is not on PATH and the package's own `Scripts` dir under `WindowsApps`
does not exist, so a **hardlink** was made into an existing PATH entry:

```
C:\Users\Abhay\.bun\bin\yt-dlp.exe  →  (hardlink to the above)
```

`yt-dlp --version` now resolves from a plain shell.

**The test failure changed, which is the interesting part.** With no yt-dlp the
suite failed `ENOENT`. With one installed it failed *differently*: the test's stub
was bypassed and the real binary hit `example.com`. Three Windows reasons, all
found by reading `test/ytdlp.test.ts`:

1. The stub was written as `yt-dlp` with **no extension**, containing a
   `#!/usr/bin/env node` shebang. Windows has no shebang handling.
2. `chmodSync(bin, 0o755)` is a no-op on Windows.
3. `process.env.PATH = \`${binDir}:${originalPath}\`` joins with **`:`**, not `;`.

Fixed: the stub is now `yt-dlp.cmd` on Windows (`@node "…stub.js" %*`), the
separator is `path.delimiter`, and `spawnSync` passes `shell: true` on win32 so a
`.cmd` can launch at all.

**But the stub still lost.** Windows resolves a bare name through PATHEXT, and
`.EXE` is tried before `.CMD` — so the real yt-dlp won regardless of PATH order.
The durable fix is a `KINO_YTDLP` env override in `src/remote/ytdlp.ts`
(`ytdlpBinary()`), which the test sets to the stub path. That also serves real
users with a non-standard install.

**Status: 4 ytdlp tests still failing.** The override is in and typechecks, but
the failure persists with `The system cannot find the path specified`. A
standalone reproduction of the same `.cmd` + `shell: true` call **succeeds**
(status 0, correct args including `%(ext)s`), so the remaining difference is
inside vitest's worker and has not been isolated. See "next steps" below.

---

## 8. Disk pressure cleared — **environment**

C: was down to **0.4 GB free** and notes would not save. Cleared ~3.8 GB of
`%TEMP%`, ending at **4.2 GB free**:

| item | freed |
| --- | --- |
| 31 `kino-preview-*` dirs | 1,041 MB |
| `opencode\siora-clean` (stale `node_modules`, Nov 15) | 931 MB |
| everything else in `%TEMP%` | ~1,887 MB |

The `kino-preview-*` dirs are **ticket 029's leak** — one accumulates per preview
run, ~33 MB each. Eight call sites still use `tmpdir()` instead of scratch beside
the output. They will refill C:. Fixing them is the highest-value small job next
session.

---

## 9. Ticket 029 closed — scratch no longer lands on `os.tmpdir()`

All eight `mkdtempSync(join(tmpdir(), …))` call sites now go through
`scratchDir()`, which puts scratch in a `.kino/` folder beside the output:

| file | prefix | anchored on |
| --- | --- | --- |
| `preview.ts` | `kino-preview-` | new `PreviewOptions.scratchDir` |
| `render.ts` | `kino-`, `kino-extract-` | `options.output` |
| `export.ts` | `kino-export-` | `output` |
| `export.ts` | `kino-frames-` | `options.frameDir` |
| `elements/takumi-elements.ts` | `kino-takumi-` | default (cwd `.kino/`) |

`grep 'mkdtempSync(join(tmpdir' src/` now returns nothing. The one remaining
`tmpdir()` in `export.ts` is `safeCwd()`'s last-resort fallback when the cwd has
been unlinked — that is not scratch and was left alone.

**Why the previews leaked even though `close()` deletes the dir:** a killed
process (Ctrl-C, crash, the OS reclaiming memory) never reaches `close()`, so the
whole proxy survived — ~33 MB per run, 31 folders found. `Preview.open` now also
registers a one-shot `process.once("exit", …)` cleanup. `close()` stays as the
normal path; the hook is idempotent because `rmSync` runs with `force`.

**Verified:** after a full suite run, **zero** `kino-preview-*` dirs in `%TEMP%`,
and the only scratch created was `D:\Projects\Misc\kino\.kino\kino-takumi-*`.
Suite unchanged at **5 failures** (1 export, 4 ytdlp) — no new ones.

---

## 10. Voice showcase server — audition any engine, any voice, any line

The chapter's dialogue sounded flat because it runs on **Kokoro**, which reads
punctuation as pauses rather than performance. `"So cuuu-uute! Kyaa-aaah!"` came
out as spelled-out vowels with a comma where the exclamation is. Measured across
the 27 Pocket voices, that same line runs **2.24 s to 6.48 s** — the long ones
are acting it, the short ones are reading it.

`src/tts/showcase.ts` — `serveShowcase()`, exported from the package.

| route | what |
| --- | --- |
| `/` | audition page: line box, engine picker, one player per voice |
| `/api/catalog` | engines, voices, presets, saved lines, picks |
| `/api/say?engine=&voice=&text=&rate=` | one WAV, rendered on demand |
| `POST /api/lines`, `DELETE /api/lines` | saved lines |
| `POST /api/picks`, `DELETE /api/picks` | shortlisted engine+voice+line |

Design notes worth keeping:

- **kino does not know which voices exist.** Every engine names its own, so a
  hard-coded list would go stale. The caller supplies the catalog — the
  composition's business, not the engine's.
- **`/api/say` is a GET** so a browser can use it directly as `<audio src>`.
  That is what makes a grid of 27 players work with no client framework.
- **Persistence is server-side**, in `.kino/showcase/{lines,picks}.json` beside
  the output — not the system temp dir, and not `localStorage`, so a shortlist
  survives a restart and can be inspected or committed.
- A corrupt save returns the fallback rather than failing to start.

Verified: `/api/catalog` reports **pocket(27), kokoro(10)**, 9 chapter presets;
`/api/say` returns a valid RIFF/WAVE (83 KB, 74 KB non-silent) for
`kokoro/af_bella`.

**Blocker, and it is not kino's:** Pocket needs an adapter script in paper-ghost
(`kino-pocket.py`), the same way Kokoro has `kino-kokoro.py`. A draft is at
`kino/.kino/kino-pocket.py`; it has to be saved into paper-ghost by hand,
because kino does not write to that project. Until then `/api/say?engine=pocket`
correctly 500s with `can't open file ...kino-pocket.py`.

**Timing**, which is why Chatterbox was rejected: Pocket ~1–2 s/line (~2–3 min
for 70 scenes), Kokoro ~1 s/line, Chatterbox **23–56 s/line** (~30–60 min).

---

## 11. Folder hygiene — root scripts moved under `scripts/`

Seven harnesses were sitting at the repo root. They are useful, so they moved
rather than being deleted:

```
scripts/preview/{chapter,chapter-live,ghost}.ts
scripts/showcase/index.ts
scripts/probe/{proxy.mjs,videoonly.ts,serve-file.mjs}
```

`scripts/README.md` explains each folder. The repo root now holds only
`tsup.config.ts`, `vitest.config.ts` and `vitest.dist.config.ts`.

**Trap hit:** `git mv x y -ErrorAction SilentlyContinue` — PowerShell passes
`-ErrorAction` through to git, which fails with `unknown switch 'E'`. Use plain
`git mv`, or `Move-Item` for untracked files.

---

## 12. The voice showcase, rebuilt three times

The first version rendered every voice at once into a grid of 27 players. That
is not an audition, it is a wall of sound. The second tried a take sheet with
counters, a shortlist and an "audition all" run. The third is the one that
shipped, because the question was narrower than all of that.

**What it is:** type a line, pick model and voice, press OK, and the player
appears below. Session history of rendered clips, newest first, replayed by
clicking. Newest render stops the previous one.

**Routes** (`src/tts/showcase.ts`, exported as `serveShowcase`):

| route | what |
| --- | --- |
| `GET /` | the page |
| `GET /api/catalog` | engines, voices, presets, saved lines |
| `GET /api/say?engine=&voice=&text=` | one clip |
| `GET/POST/DELETE /api/lines` | saved lines, SQLite-backed |

**Engines have two shapes.** A `command` engine spawns a script (Kokoro); an
`http` engine POSTs to a server (Pocket). Both end as bytes plus a content type.

### Pocket TTS: the API is the fix, not the adapter

Pocket failed for four turns with `TTS command exited with code 2`, because the
adapter `kino-pocket.py` has to live in paper-ghost and **kino cannot write
there**. The adapter was never going to exist by itself.

The fix was to stop needing it. Pocket ships a FastAPI server:

```sh
cd D:/Projects/Misc/paper-ghost
.venv-pocket/Scripts/python.exe -m pocket_tts serve --port 8200
```

`POST http://localhost:8200/tts` with `text` and `voice_url` returns
**audio/wav** directly — 182 KB, ~1 s. No file in the composition's project.

Port 8200, not the default 8000, which the preview server owns.

### Two bugs worth remembering

**A `\n` in a template literal killed the whole page.** `showcase-page.ts`
builds the HTML with a template literal, so `"\n"` became a real newline and the
inline `<script>` failed to parse. Both dropdowns rendered empty and nothing
worked. The fix is `"\\n"`. Checking that the *markup* contains an element is
not the same as checking the *script runs* —
`scripts/showcase/verify-page.mjs` now parses the served page in `vm` and
executes it against a DOM shim before the page is called done.

**`node:sqlite` does not survive bundling.** esbuild strips the `node:` scheme
and emits `from "sqlite"`, which is not a package. Neither `external` nor an
`onResolve` plugin kept the prefix; a bare `require` fails in the ESM bundle
(`Dynamic require ... is not supported`); top-level await fails the CJS build.
What works is `createRequire(import.meta.url)` with the id built as
`"node:" + "sqlite"`, resolved lazily. `@types/node` here is v20, so
`src/types/node-sqlite.d.ts` declares the small surface used.

### A process note

An ElevenLabs adapter was built and then deleted. It came from misreading a
screenshot of the ElevenLabs UI as a request to integrate it. It was a design
reference. Ask before building an integration; a screenshot is not a spec.

---

## 13. Folder hygiene

Seven harnesses sat at the repo root. They moved, not deleted:

```
scripts/preview/{chapter,chapter-live,ghost}.ts
scripts/showcase/{index.ts,verify.mjs,verify-page.mjs}
scripts/probe/{proxy.mjs,videoonly.ts,serve-file.mjs}
scripts/README.md
```

Root now holds only `tsup.config.ts`, `vitest.config.ts`, `vitest.dist.config.ts`.

---

## 14. Servers started in a background shell die with that shell

**This bit twice in one session**, both times silently.

The preview server, the showcase and Pocket's TTS server were all started as
background jobs. A background job has a timeout, and when it expires the process
is killed — taking the listening server with it. The symptom is not an error the
user can act on:

- the preview at :8000 simply stops answering;
- the showcase reports `VOICE_CLONING_UNSUPPORTED`, because Pocket was gone and
  a cold restart had not loaded the voice catalog, so names fell through to the
  cloning path.

The second one cost most of a turn: `VOICE_CLONING_UNSUPPORTED` reads like a
permissions problem, and the real cause was "the server is not running".

**The fix is `.cmd` scripts the user starts and leaves open:**

| script | serves |
| --- | --- |
| `scripts/preview/start-preview.cmd` | the chapter at :8000 |
| `scripts/showcase/start-pocket.cmd` | Pocket TTS at :8200 |
| `scripts/showcase/start-showcase.cmd` | the showcase at :4100 |

**What it means for verification.** "It responded once" is not the test. The
test is "it will still be running when the user tries it". Any server handed
over has to have a start path that does not depend on an agent's shell lifetime.

**Also:** the showcase now turns a refused connection into
`Pocket TTS is not running at http://localhost:8200/tts. Start it first — see
scripts/showcase/start-pocket.cmd.`, and a `VOICE_CLONING_UNSUPPORTED` reply into
`the server does not know the voice 'X'`. A traceback is not an error message.

---

## Honest state at session end

- Full suite: **5 failures across 2 files** — 1 export (`frames are named from
  the timestamp`), 4 ytdlp. The ytdlp four have *changed cause* (see change 7):
  they are no longer the Unix-shebang problem but a vitest-environment problem
  that is not yet isolated. Everything else passes: 398/455.
- Changes 5–8 are **uncommitted**. `git status` also shows a pile of scratch
  probes at the repo root (`probe-*.mjs`, `probe-*.ts`, `serve-file.mjs`) that
  should be deleted or moved before the next commit.
- Change 6 (live compositing) never served a frame over HTTP and is parked.
  The proxy path is the working preview and was verified this session:
  **`ALL FRAMES OK`** — 360p, 921,600 B/frame, 1–8 ms sequential, ~1.4 s per jump.
- **The proxy build is still an export.** 196 s for the 177 s chapter at 360p.
  Everything after the build is realtime; the build is the wait.
- The frame cache now **slides with the playhead** (committed in working tree,
  verified: cold ~1.2 s per region, then 0.3–0.9 ms/frame).
- Eight scratch call sites still use `tmpdir()` directly, and they filled C:.
  **Fixed (change 9)** — all eight now use `scratchDir()`, and `Preview.open`
  registers an `exit` hook so a killed server cannot leave its proxy behind.

### Next steps, in order

1. **Audition the 27 Pocket voices** at http://localhost:4100 and shortlist a
   voice per character — Kaguya, Hayasaka, Chika, Ishigami, narrator. The
   `am_michael` collision (narrator and Ishigami sharing one voice) should not
   survive the change.
2. **Rewire `chapter.mts`** to `pocket(...)`. Pocket now runs over HTTP on
   `localhost:8200` (`python -m pocket_tts serve --port 8200`), so no adapter
   script is needed. Port 8200, not 8000 — the preview owns 8000.
3. **Fix the 4 ytdlp tests.** The override is correct; isolate why the `.cmd`
   fails under vitest but succeeds standalone. Start by logging `res.stderr` and
   `process.env.KINO_YTDLP` from inside the test.
4. ~~**Ticket 029 — move the 8 `tmpdir()` call sites.**~~ **Done this session
   (change 9).** Verified: zero `kino-preview-*` dirs after a full run.
5. **Segment cache for the proxy** (`renderSegmented` + `cacheDir`) so an edit
   re-renders only changed scenes. That is the real fix for the build wait.
6. **Timeline UI**: scene labels, audio strip via `audio-levels.ts`, current-scene
   indicator.
