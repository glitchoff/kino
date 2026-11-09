# The alignment model

`mms-forced-align` is an optional neural model used by `captionsAsync()` to time
words against real audio. Nothing in kino requires it.

## What it is

A wav2vec2 acoustic model (MMS, quantised, ~317 MB) that maps audio to
characters. Given audio and the words that should be in it, it finds the most
likely time span for each word. That is **forced alignment**: it does not
transcribe — it needs the text up front and only decides *when* each word
happens.

Because it is neural, two properties drive everything else:

- **Cost is quadratic in audio length.** Self-attention compares every position
  against every other, so a longer input is disproportionately more expensive.
- **It is memory-bound, not CPU-bound.** It fits comfortably in a few GB for
  short clips and not at all for a full song.

## Installing

```bash
npx kino setup captions
```

This installs the package into `~/.cache/kino/captions/node_modules` — a shared,
machine-wide location — and warms the model. It deliberately does **not** touch
your project's `package.json` or lockfile.

Loading order at runtime:
1. a project-local `mms-forced-align`, if you added one yourself;
2. the shared cache copy, loaded by absolute path;
3. neither — `captionsAsync()` falls back to even timing.

Deleting `~/.cache/kino/captions` removes it entirely; captions keep working.

## Why long audio fails, and what to do

A single pass over a 2–4 minute track allocates attention matrices of tens of
gigabytes. On a machine without swap the kernel kills the process, and because
Node never sees an error you get a bare `exit=143` with no output.

Chunk instead:

- cut the audio into ~24 s windows with ~4 s overlap;
- align each window against the **next stretch** of the lyric sheet;
- accept words that start before the overlap, then advance;
- shift each result by the window's start time.

Give each window only as much transcript as fits (~3.2 words/second plus a
little slack). Handing the model the entire remaining sheet makes it fail with
`viterbiAlign: no valid alignment path exists`.

## Checking the result

Every span carries a `score`. Real matches sit around 0.8–1.0; a score near 0
(e.g. on a one-letter word) means the model had almost nothing to latch onto.
Sanity-check a few lines against the audio before trusting a whole render.
