/**
 * Scenes sized from their own narration.
 *
 * `await voice(...)` synthesises a line now and reports how long it is, so a
 * scene can be exactly as long as it takes to say the words plus a short tail.
 * The measured `Voice` is also what gets played, so nothing is synthesised
 * twice, and it can be reused in as many scenes as you like.
 *
 * Requires Piper on PATH (`pip install piper-tts`) and downloads the voice on
 * first run (~63 MB). Voices and audio are cached globally in ~/.cache/kino/tts.
 *
 *   npx kino examples/narration-fit.ts -o out.mp4
 */
import { composition, voice, render } from "@glitchoff/kino";

const LINES = [
  { line: "Where the mind\nis without fear", speak: "Where the mind is without fear." },
  { line: "Where knowledge\nis free", speak: "Where knowledge is free." },
  { line: "Into that heaven\nof freedom", speak: "Into that heaven of freedom, my Father, let my country awake." },
];

// Measure everything up front, in parallel. Each call is cached by text +
// voice + rate, so a re-run is a file read rather than a Piper spawn.
const spoken = await Promise.all(
  LINES.map(async (item) => ({
    ...item,
    said: await voice(item.speak, { voice: "en_US-lessac-medium", rate: 0.95 }),
  }))
);

const comp = composition({ width: 1080, height: 1920, fps: 30 });

for (const item of spoken) {
  // The scene is as long as the speech plus 0.6s of breathing room, so the
  // last word is never clipped by the cut.
  comp.scene({ duration: { fit: item.said }, background: "#0b1120" }, (s) =>
    s
      .text(item.line, { fontSize: 72, color: "#f8fafc", x: "center", y: "center", align: "center" })
      .say(item.said)
  );
}

// The number is available as plain seconds, so it works anywhere a duration
// does — animations, audio offsets, comparisons:
//
//   .text("…", { animation: fadeIn(Math.min(0.5, item.said.seconds / 4)) })
//   comp.scene({ duration: item.said.seconds + 2 })
//
// A long line can also set a floor:
//
//   comp.scene({ duration: { fit: item.said, pad: 1.2, min: 4 } })

const video = comp.build();

if (import.meta.main) {
  await render(video, { output: "out/narration-fit.mp4" });
}

export default video;
