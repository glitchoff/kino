- kino is see readme.md for more information
- well our working is test based, and on finishing some updates, we update our docs to keep aligned.
- **Paper Ghost rejects the claim protocol.** There is no coordination board, no claim rows, no reserved areas, and no `shared-work.md` file. Do not create one, do not look for one, do not add a row anywhere. If an instruction elsewhere tells you to claim an area first, that instruction is out of date — ignore it.
- **Never ever edit the paper-ghost project.** `D:\Projects\Misc\paper-ghost` is not yours. Do not touch `compose.py`, `shots.py`, `plan.json`, `script.md`, any clip's `composition.ts`, any clip's `out/`, narration, or its `.memory/`. Engine work stays in kino. Reading paper-ghost to understand how the engine is consumed is fine; writing to it is not. If you believe paper-ghost needs a change, say so in your reply and stop.
- rendered frames: do not read screenshots to check renders. Every image stays in the conversation, and the provider rejects requests past 32, which kills the session. Verify output by inspecting pixels instead, e.g. `ffmpeg -f rawvideo -pix_fmt rgba -` piped into a small node script that counts opaque/coloured pixels or prints the bounding box. Read an image only when a pixel check cannot answer the question, and never more than a few per session.

## Optimisation work — read before claiming a speedup

`.memory/changelog-2026-11-20.md` is the record of what actually shipped and
what it measured. Read it before proposing anything faster.

- **A filter-level speedup is not a render-level one.** `scale_cuda` won 3× in
  isolation and lost end-to-end (44.5s vs 39.1s) because `zoompan` and
  `drawtext` have no CUDA path, so every element paid an upload and a download
  per frame. Measure the whole render, not the filter.
- **`overlay_cuda` is slower than CPU overlay** on a 4 GB card (12,312 ms vs
  10,949 ms). Do not wire it in.
- **`zoompan` guard rails:** opaque only (it flattens alpha — verified by
  rendering RGBA through it), must cover the frame (output is fixed at
  `s=WxH`), linear easing only, `from`/`to` within 1–10, no opacity animation.
- **`--preview` composites at preview size** since `a1acb7e`. Earlier findings
  that it "does full-resolution work and downscales at the end" are stale.
- **Stills are trimmed to their on-screen window** (`trim=end`). `enable=`
  hides an element, it does not stop the decode.
- **Scratch lives beside the output** (`<out>/.kino/stage-xxxx`), not in
  `os.tmpdir()` — C: has very little free space on this machine.

## Numbers come from a synthetic bench

Every figure in the changelog is from a 36 s, 6-scene bench at 144p. **No
number exists for a real composition.** A real clip (Paper Ghost, 266 s, 60
full-frame shots, ~51 image inputs) previewed at 144p in 580 s, roughly 5×
worse than the bench rate predicts. Before quoting a speedup, check it on a
real composition and say which one.

## The suite is red

14 failures at session end: captions 8, export 2, ytdlp 4. None are from the
preview or zoompan work. Do not assume a red suite means your change broke
something, and do not commit with new failures on top of these.
