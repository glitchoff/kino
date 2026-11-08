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
import { captionElements, composition, type WordTiming, type ElementAnimation } from "@glitchoff/kino";

const here = dirname(fileURLToPath(import.meta.url));
const audio = join(here, "assets/co2.mp3");
const timingsPath = join(here, "assets/co2-words.json");

const words = JSON.parse(readFileSync(timingsPath, "utf8")) as WordTiming[];
const duration = 163.73;

// Group into display lines: break on sentence punctuation, on a musical gap, or
// at five words. Short lines stay readable at this size.
const lines: WordTiming[][] = [];
let current: WordTiming[] = [];
for (let i = 0; i < words.length; i++) {
  current.push(words[i]);
  const next = words[i + 1];
  const gap = next ? next.start - words[i].end : Infinity;
  if (/[.?!,]$/.test(words[i].word) || current.length >= 5 || gap > 0.8) {
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
  const [built] = captionElements(line, {
    style: "block",
    wordsPerLine: line.length,
    fontSize: 66,
    y: "center+90",
    color: "#ffffff",
  });
  return [
    {
      ...built,
      startAt: line[0].start,
      duration: Math.max(0.2, line[line.length - 1].end - line[0].start),
      animation: ENTRIES[index % ENTRIES.length],
    },
  ];
});

export default composition({ width: 1280, height: 720, fps: 24 })
  .scene(
    {
      duration,
      background: { type: "gradient", from: "#141c30", to: "#05060a", direction: "vertical" },
    },
    (s) => s.addAll(captions)
  )
  .audio({ src: audio, duration })
  .build();
