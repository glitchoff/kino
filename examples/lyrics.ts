/**
 * Lyric video: a whole song with timed, animated lyric lines.
 *
 * The word timings come from forced alignment of the full lyric sheet against
 * the recording, and are committed alongside the audio so this renders with no
 * model, no network and no ~317 MB download — which is what makes it practical
 * on a CI runner.
 *
 * Each line enters with a different motion (rise, slide, pop) so the video does
 * not look mechanical. Animations are per LINE rather than per word: animating
 * every word multiplies the filter count enough to stall the render.
 *
 *   npx kino examples/lyrics.ts -o out/lyrics.mp4
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  captionElements,
  captionImages,
  composition,
  type WordTiming,
  type ElementAnimation,
} from "@glitchoff/kino";

const here = dirname(fileURLToPath(import.meta.url));
const audio = join(here, "assets/co2.mp3");
const timingsPath = join(here, "assets/co2-words.json");

const words = JSON.parse(readFileSync(timingsPath, "utf8")) as WordTiming[];

// Both are configurable so a CI run can render a short clip with word
// highlighting, which is far heavier than whole-line captions.
//   KINO_LYRICS_SECONDS=30   render only the first 30s
//   KINO_LYRICS_STYLE=frames  word-level highlight (image based; scales)
//   KINO_LYRICS_STYLE=karaoke  word-level highlight (drawtext; stalls past ~6 lines)
const fullDuration = 163.73;
const limit = Number(process.env.KINO_LYRICS_SECONDS ?? fullDuration) || fullDuration;
const duration = Math.min(limit, fullDuration);
const style = (process.env.KINO_LYRICS_STYLE ?? "block") as "block" | "karaoke" | "frames";

const inRange = words.filter((w) => w.start < duration);

// Group into display lines: break on sentence punctuation, on a musical gap, or
// at five words. Short lines stay readable at this size.
const lines: WordTiming[][] = [];
let current: WordTiming[] = [];
for (let i = 0; i < inRange.length; i++) {
  current.push(inRange[i]);
  const next = inRange[i + 1];
  const gap = next ? next.start - inRange[i].end : Infinity;
  if (/[.?!,]$/.test(inRange[i].word) || current.length >= 5 || gap > 0.8) {
    lines.push(current);
    current = [];
  }
}
if (current.length) lines.push(current);

/** Entrance motions, rotated so consecutive lines do not look identical. */
const ENTRIES: ElementAnimation[] = [
  {
    opacity: { from: 0, to: 1, duration: 0.4, easing: "easeOut" },
    y: { from: 46, to: 0, duration: 0.5, easing: "easeOut" },
    scale: { from: 0.94, to: 1, duration: 0.5, easing: "easeOut" },
  },
  {
    opacity: { from: 0, to: 1, duration: 0.4, easing: "easeOut" },
    x: { from: -70, to: 0, duration: 0.5, easing: "easeOut" },
  },
  {
    opacity: { from: 0, to: 1, duration: 0.4, easing: "easeOut" },
    x: { from: 70, to: 0, duration: 0.5, easing: "easeOut" },
  },
  {
    opacity: { from: 0, to: 1, duration: 0.35, easing: "easeOut" },
    scale: { from: 1.12, to: 1, duration: 0.45, easing: "easeOut" },
  },
  {
    opacity: { from: 0, to: 1, duration: 0.4, easing: "easeOut" },
    y: { from: -40, to: 0, duration: 0.5, easing: "easeOut" },
  },
];

const captions = lines.flatMap((line, index) => {
  // Karaoke returns one element per line carrying per-word timings; block
  // returns the same element without them. Animation is applied to whichever
  // comes back, so both styles move the same way.
  const [built] = captionElements(line, {
    style: style === "frames" ? "block" : style,
    wordsPerLine: line.length,
    fontSize: 66,
    y: "center+90",
    color: "#ffffff",
  });
  // `captionElements` already sets startAt/duration from the words; overriding
  // them would desync the per-word timings karaoke relies on.
  return [
    {
      ...built,
      animation: ENTRIES[index % ENTRIES.length],
    },
  ];
});

/**
 * Word-level highlight as one pre-rasterised image per word.
 *
 * `karaoke` redraws the whole line for every word, so ffmpeg keeps a
 * full-frame copy per word alive and the render collapses past about six
 * lines. Here the line is rasterised once per word state and the composition
 * only swaps images, which costs the same per frame at any length.
 */
async function frameCaptions() {
  // All words at once, so line holds are trimmed against the following line
  // and no two lines can be on screen together.
  const wordFrames = await captionImages(inRange, {
    // Rasterise at 2x and display at 1280x140: drawtext at 1x looks soft next
    // to native text once the encoder scales it.
    width: 2560,
    height: 280,
    displayWidth: 1280,
    displayHeight: 140,
    dir: join(here, ".karaoke-frames"),
    fontSize: 132,
    wordsPerLine: 5,
    color: "#ffffff",
    highlight: "#f5b544",
    x: 0,
    // Where the strip lands on the 720-high frame; matches `center+90` at
    // this font size so the two styles sit at the same height.
    y: 290,
  });
  // No entrance animation on the word frames: each frame replaces the last, so
  // a fade or slide would restart on every word and the line would flicker.
  return wordFrames;
}

export default async function () {
  // Image frames need async rasterising, so they are resolved before the
  // scene is built; the block and karaoke styles are already plain arrays.
  const elements = style === "frames" ? await frameCaptions() : captions;
  return composition({ width: 1280, height: 720, fps: 24 })
    .scene(
      {
        duration,
        background: { type: "gradient", from: "#141c30", to: "#05060a", direction: "vertical" },
      },
      (s) => s.addAll(elements)
    )
    .audio({ src: audio, duration })
    .build();
}
