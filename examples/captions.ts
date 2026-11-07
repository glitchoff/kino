/**
 * Karaoke captions: a line of speech, with each word lighting up as it is said.
 *
 * The text is already known — it is the line you asked Piper to say — so no
 * speech recognition is involved. Timing comes from `mms-forced-align` when it
 * is installed, and from even word distribution otherwise, so this runs with
 * nothing beyond Piper.
 *
 *   npx kino setup captions          # optional: word-perfect timing (~317 MB)
 *   npx kino examples/captions.ts -o out.mp4
 */
import { composition, voice, captions, render } from "@glitchoff/kino";

const LINES = [
  "Where the mind is without fear.",
  "Where knowledge is free.",
  "Into that heaven of freedom, let my country awake.",
];

// Measure every line up front so scenes can be sized from their own audio.
const spoken = await Promise.all(
  LINES.map(async (text) => ({
    text,
    said: await voice(text, { voice: "en_US-lessac-medium", rate: 0.95 }),
  }))
);

const comp = composition({ width: 1080, height: 1920, fps: 30 });

for (const { text, said } of spoken) {
  // Captions are built once per line and reused, exactly like the Voice.
  const caps = captions(said, {
    style: "karaoke",
    wordsPerLine: 5,
    fontSize: 64,
    y: "center+240",
    highlight: "#38bdf8",
  });

  comp.scene({ duration: { fit: said }, background: "#0b1120" }, (s) =>
    s
      .text(text, {
        fontSize: 72,
        color: "#f8fafc",
        x: "center",
        y: "center-120",
        align: "center",
        maxWidth: 900,
      })
      .addAll(caps)
      .say(said)
  );
}

// Other styles:
//
//   captions(said, { style: "word" })    // one word at a time, full screen
//   captions(said, { style: "block" })   // timed subtitles, no highlight
//
// With the optional aligner installed, timing becomes exact:
//
//   const caps = await captionsAsync(said, { style: "karaoke" });

const video = comp.build();

if (import.meta.main) {
  await render(video, { output: "out/captions.mp4" });
}

export default video;
