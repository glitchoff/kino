# Word-level captions

Captions that light up word by word, timed either by an even spread or by a
neural forced aligner.

## Quick start

```ts
import { captions, composition, voice } from "@glitchoff/kino";

const line = await voice("Where the mind is without fear.");

const comp = composition({ width: 1920, height: 1080 })
  .scene({ duration: { fit: line } }, (s) =>
    s.addAll(captions(line, { style: "karaoke" }))
  )
  .build();
```

`captions()` needs no extra install: it spreads the words across the audio by
length, pausing at punctuation. That is accurate for TTS, which reads at a
steady pace.

## Styles

| Style | Result |
| --- | --- |
| `karaoke` (default) | A group of words; each lights up as it is spoken |
| `reveal` | Words appear one at a time and stay, so the line builds up |
| `word` | One word at a time, replacing the last |
| `block` | Timed subtitles — a group appears together, no highlight |

Options: `wordsPerLine` (4), `y` (`"bottom-240"`), `x`, `fontSize` (56),
`color` (`#f8fafc`), `highlight` (`#38bdf8`), `fade`, `hold`, `zIndex`, `at`.

## Exact timing from real audio

For a song or any recording, use forced alignment:

```bash
npx kino setup captions   # installs the aligner + model (~317 MB, one time)
```

```ts
const caps = await captionsAsync(line, { style: "karaoke" });
```

`captionsAsync()` aligns when the model is installed and falls back to even
timing when it is not, so the same code works either way.

The aligner is **never a dependency**. It installs into `~/.cache/kino/captions`,
not your project, so there is no manifest or lockfile change and every project
on the machine shares one copy. To remove it, delete that directory.

## How the highlight is drawn

`drawtext` colours a whole string at once, so a per-word highlight cannot be one
filter. Instead the line is drawn dim, then a second copy is drawn in the
highlight colour and **cropped to the active word's box** and overlaid. Because
it is the same text at the same size and origin, the crop lines up exactly, and
works with any font and with wrapped lines.

Word boxes come from `estimateTextWidth`, the same estimator the renderer uses
to wrap, so the crop agrees with what is drawn.

## Full songs: memory and speed

Two limits matter once captions get long.

**Alignment is O(n²) in audio length.** One pass over a full song needs far more
memory than a small machine has and gets OOM-killed (no swap means no error, just
`exit=143`). Align in overlapping windows instead — 24 s with a 4 s overlap
works, and each window must be given only ~3.2 words/second of transcript or the
model reports "no valid alignment path exists". A 2:43 track is ~8 windows.

**`karaoke` is slow on long videos.** Each word costs a full-frame drawtext, a
crop and an overlay, so a minute of captions is hundreds of full-resolution
passes. If a render sits at `frame=0` for tens of seconds, that is why. `block`
style renders the same minute in seconds.

## Image-based highlight: `captionImages()`

For a full song, use `captionImages()` instead of `karaoke`. It rasterises each
word state to a PNG once and returns one `ImageElement` per word, timed to that
word's span. The composition only swaps images on a timeline, so per-frame cost
does not grow with the word count: a 163 s song with word-level highlight
renders in about two minutes, where `karaoke` never finished at 12 lines.

```ts
import { captionImages } from "@glitchoff/kino";

const frames = await captionImages(timings, {
  width: 2560, height: 280,        // render size (2x)
  displayWidth: 1280, displayHeight: 140,  // on-screen size
  dir: "/tmp/karaoke-frames",
  fontSize: 132,
  wordsPerLine: 5,
  color: "#ffffff",
  highlight: "#f5b544",
  x: 0,
  y: 290,
});
```

Points that are easy to get wrong:

- **Pass every timing at once.** `buildCaptionLines` trims each line's hold so it
  cannot run into the next line, and it can only do that if it sees the
  following line. Calling `captionImages()` per line leaves holds untrimmed and
  stacks two lines on screen.
- **`width`/`height` are the PNG size, not the screen size.** Set
  `displayWidth`/`displayHeight` to the size the strip should occupy. Rasterise
  at 2x for crisp text; 1x looks soft next to drawtext once the encoder scales it.
- **Do not animate the word frames.** Each frame replaces the last, so a fade or
  slide restarts on every word and the line flickers.
- **Word widths come from the rasterised ink extent**, not
  `estimateTextWidth`. The estimator under-measures by a few pixels per word,
  which is enough to close the gaps between words.

### Verifying a render without burning images

Every image read stays in the conversation, and the provider rejects a request
past 32, which kills the session. Check renders by pixel inspection instead:
extract a frame and count opaque or coloured pixels, or print the ink bounding
box. Reading a frame is a last resort, not a first check.

## Testing

`test/captions.test.ts` covers timing, grouping and every style. Rendering
behaviour is checked by rendering a clip and inspecting extracted frames — a
graph that compiles is not proof the highlight is visible.
