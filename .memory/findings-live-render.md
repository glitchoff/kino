# Findings — live rendering

Durable facts about compositing frames on demand. Newest last.

---

## 2026-11-21 — A persistent renderer was attempted and abandoned

**Claim:** a long-lived ffmpeg that composites frames on demand is the right
shape for live preview, but it was not made to work reliably in one session and
the stateful version was removed.

### What was proven

The **graph work is real and correct**, and it is reusable:

- `src/pipeline/video-only.ts` prunes the audio chains from a compiled
  filtergraph. ffmpeg rejects a graph with an unconnected output
  (`Filter amix:default has an unconnected output`), so dropping `-map
  [a_mix_final]` is not enough — the chains must go. On the 70-scene chapter that
  is **1,838 of 2,057** chains kept.
- Two pruning bugs were found and fixed. The first dropped **141 pads still in
  use** because it treated ffmpeg source pads (`bg_scene_0`, `img_base_1`,
  `ka_base`) as needing a producer. The rule that works: any pad consumed but
  never produced by a chain is a source, derived from the graph itself.
- With that graph, `ffmpeg … -frames:v 120 -f rawvideo -pix_fmt rgba -` produced
  **120 correct frames, exit 0**, on chapter.mts at 144p.

### What was measured (chapter.mts, 70 scenes, 177 s, 144p)

| | cost |
| --- | --- |
| first frame | 10.5–14.5 s |
| 30 frames | 19.8 s |
| 120 frames | 22.5 s (~67 ms/frame steady) |

So a heavy composition composites at roughly **15 fps** — moving video, not
smooth playback. That is the composition's own cost, not overhead.

### What failed

The stateful `LiveRenderer` never served a frame reliably over HTTP. Four bugs
in sequence, each fix exposing the next:

1. **Listener leak.** `readOne` attached `once("data")`, `once("end")` and
   `once("error")` per read. A 144p frame (147 KB) spans several 64 KB chunks, so
   every request added handlers until Node warned
   (`MaxListenersExceededWarning: 11 data listeners on Socket`) and the socket
   died with ECONNRESET. Fixed by attaching one persistent reader per process.
2. **Consumed frames never re-served.** A second request for the same timestamp
   waited for a frame already handed out and deleted, then reported
   `live renderer ended at frame 5351 before 300` after the clip finished.
3. **Skip loop outrunning the target.** The restart skip pruned `key < index`
   after the target had already been buffered, dropping the frame it wanted.
4. **Then every request returned 500**, with no further diagnosis.

### The lesson

The working probe is **stateless**: spawn, read N frames, exit. The class added
buffering, skipping, restarting and a served-frame cache — four interacting state
machines written in one pass and tested only at the end. Each was individually
reasonable and collectively unverifiable.

If this is picked up again, start from the stateless shape
(`src/pipeline/live-renderer.ts` is now that shape: spawn per request, keep the
last frame, exit) and add one piece of state at a time, verifying through the
real endpoint after each.

### What to use instead

The **proxy path** (`Preview.open` without `live`) is what works today:

- builds a 144p or 360p proxy once,
- decodes it into a RAM window, sliding with the playhead,
- serves frames at **0.5–5 ms** each, verified end to end.

Its cost is time-to-first-frame, not per-frame. For a 177 s composition that is
minutes on the first build, seconds after — which is why the segment cache is the
thing to build next, not another live renderer.

**Cross-refs:** `src/pipeline/video-only.ts`, `src/pipeline/live-renderer.ts`,
`docs/studio.md`, `.memory/tickets/021-live-preview.md`.
