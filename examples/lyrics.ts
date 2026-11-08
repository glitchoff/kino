// Karaoke lyrics for a full song.
//
// Word timings come from forced alignment against the real audio (see
// .memory/guide/alignment-model.md). They are checked in so the example needs
// no model, no network and no ~317 MB download to render.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { captionElements, composition, type WordTiming } from "@glitchoff/kino";

const here = dirname(fileURLToPath(import.meta.url));
const audio = join(here, "assets/co2.mp3");
const timingsPath = join(here, "assets/co2-words.json");

const words = JSON.parse(readFileSync(timingsPath, "utf8")) as WordTiming[];
const duration = 163.73;

// Group words into display lines: break on sentence punctuation, on a musical
// gap, or once a line reaches five words. Short lines stay readable at 64px.
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

const captions = lines.flatMap((line) =>
  captionElements(line, {
    style: "block",
    wordsPerLine: line.length,
    fontSize: 64,
    y: "center+100",
    color: "#ffffff",
  })
);

export default composition({ width: 1280, height: 720, fps: 24 })
  .scene(
    {
      duration,
      background: { type: "gradient", from: "#101828", to: "#05060a", direction: "vertical" },
    },
    (s) => s.addAll(captions)
  )
  .audio({ src: audio, duration })
  .build();
