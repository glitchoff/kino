# Trimming video sources

`trimStart` and `trimEnd` pick the segment of a source file to play.

```ts
s.video("/clips/intro.mp4", { trimStart: "0:32", trimEnd: "0:45" })
```

That plays 13 seconds: source 32 s → 45 s.

## Rules

- Times accept `mm:ss`, `hh:mm:ss` (with fractional seconds), plain seconds, or
  a number. `"0:32"`, `"1:02.5"`, `"1:00:05"`, `90`, `"12s"` all work.
- With both ends set and no `duration`, the element's duration becomes
  `trimEnd - trimStart`. That is what an author expects from a pair of
  timestamps.
- An explicit `duration` **wins** over `trimEnd`. Use it when the element should
  show less of the clip than you have marked.
- `trimEnd` must be greater than `trimStart`, otherwise normalization throws.
- A leading clock component may exceed 59 (`"90:00"` is 90 minutes); every
  other component is capped at 59, and a malformed clock throws rather than
  parsing to something surprising.

## What it actually does

`trimStart` is a seek on the input and the element duration drives
`trim=duration=…` in the filtergraph, so the source really is cut — not just
shortened on the timeline. This is worth verifying by eye: render a clip and
confirm the first frame matches the source at `trimStart`, not at zero.

## Related

- `loop: true` repeats a short source to fill `duration`.
- `volume` defaults to `0`, which silences the source; set it to opt audio in.
