/**
 * Text-to-speech narration.
 *
 * Requires Piper on PATH (`pip install piper-tts`) and downloads the voice on
 * first render (~64 MB). Voices are cached globally in ~/.cache/kino/tts.
 *
 *   npx kino examples/tts-narration.ts -o out.mp4
 */
import { composition, tts } from "@glitchoff/kino";

const comp = composition({ width: 1080, height: 1920, fps: 30 })
  .scene({ id: "hindi", duration: 4, background: "#0f172a" }, (s) =>
    s
      .text("नमस्ते", { fontSize: 120, color: "#ffffff", x: "center", y: "center-120" })
      .say("नमस्ते, यह Kino से बनाया गया है।", { voice: "hi_IN-rohan" })
  )
  .scene({ id: "english", duration: 4, background: "#1e293b" }, (s) =>
    s
      .text("Hello", { fontSize: 120, color: "#ffffff", x: "center", y: "center-120" })
      .say("And this is English, rendered by Piper.", { voice: "en_US-lessac-medium" })
  );

// You can also attach speech at composition level:
comp.audio([{ src: tts("Kino is scripting-first.", { voice: "en_US-amy-medium" }), startTime: 8 }]);

export default comp.build();
