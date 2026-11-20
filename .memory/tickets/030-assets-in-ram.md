# 030 — Scratch in RAM, opt-in

**Status:** implemented (2026-11-20) — `ram: true` on `RenderOptions`, wired into
`compile.ts`. Default off.
**Created:** 2026-11-20
**Requested as:** "assets in ram — if too much, do in batches" → revised to
"opt in" once it was clear the working set is small.

## What shipped

`render(comp, { ram: true })` keeps staging in memory instead of on disk.

| Platform | How |
| --- | --- |
| Linux | `/dev/shm` is a real `tmpfs`, used automatically |
| Windows | no built-in RAM disk — `KINO_RAMDISK` must name one (e.g. `R:\`) |
| Anything else | falls back to disk **with a warning**, never silently |

The fallback warns on purpose: a caller who asked for memory and got disk should
know. Silently pretending is how you end up measuring the wrong thing.

## Why opt-in and not default

A render that quietly exhausts memory is worse than a slow one. RAM is shared
with everything else on the machine, and kino cannot know what a long captioned
render will need. The default stays on disk, beside the output (029).

## Why no batching

Dropped by decision: the compositions are small enough that the working set fits
without budgeting or eviction. Batching would be solving a problem that does not
occur. If it ever does, the answer is still just "point `KINO_TMP` at a RAM
disk" — not a budget system inside kino.

## Constraint worth keeping

ffmpeg needs **seekable** input for `-loop 1 -i panel.jpg`. A stdin pipe is not a
drop-in for a panel. Memory-backed *files* are the only honest option, which is
why this is a filesystem path rather than a stream — nothing in the filtergraph
changes.

## Relationship to 029

029 is where scratch lives by default (beside the output). This ticket is the
same mechanism pointed at memory when asked. `KINO_TMP` overrides both.
