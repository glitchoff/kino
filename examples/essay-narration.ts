/**
 * "Word by word" narration: a famous speech revealed one line at a time while
 * a Hinglish voice-over reads it.
 *
 * ~60 seconds, 1080x1920, with transitions, colour and a bold font.
 *
 * Requires Piper on PATH (`pip install piper-tts`). The Hindi and English
 * voices download on first render (~63 MB each, cached globally).
 *
 *   npx kino examples/essay-narration.ts -o out.mp4
 */
import { composition, withDefaults, text, fadeIn } from "@glitchoff/kino";

// ---------------------------------------------------------------------------
// Look
// ---------------------------------------------------------------------------

const BG = "#0b1120";
const INK = "#f8fafc";
const ACCENT = "#38bdf8";
const MUTED = "#94a3b8";

const Heading = withDefaults(text, {
  fontSize: 64,
  color: INK,
  x: "center",
  y: "center",
  align: "center",
  lineHeight: 1.2,
});

const Sub = withDefaults(text, {
  fontSize: 38,
  color: MUTED,
  x: "center",
  y: "center",
  align: "center",
});

const Word = withDefaults(text, {
  fontSize: 72,
  color: INK,
  x: "center",
  y: "center",
  align: "center",
});

// ---------------------------------------------------------------------------
// Content — Tagore's "Where the mind is without fear", with a Hinglish intro.
// Each beat is a line of the speech; the voice-over reads it as it appears.
// ---------------------------------------------------------------------------

interface Beat {
  id: string;
  line: string;
  speak: string;
  voice: string;
  seconds: number;
  accent?: boolean;
}

const BEATS: Beat[] = [
  {
    id: "title",
    line: "Where the mind\nis without fear",
    speak: "Ek famous speech, line by line. Suniye.",
    voice: "hi_IN-rohan",
    seconds: 9,
    accent: true,
  },
  {
    id: "l1",
    line: "Where the mind is\nwithout fear\nand the head is held high",
    speak: "Where the mind is without fear, and the head is held high.",
    voice: "en_US-lessac-medium",
    seconds: 10,
  },
  {
    id: "l2",
    line: "Where knowledge\nis free",
    speak: "Where knowledge is free.",
    voice: "en_US-lessac-medium",
    seconds: 8,
  },
  {
    id: "l3",
    line: "Where the world has\nnot been broken up\ninto fragments",
    speak: "Where the world has not been broken up into fragments by narrow domestic walls.",
    voice: "en_US-lessac-medium",
    seconds: 11,
  },
  {
    id: "l4",
    line: "Where words come out\nfrom the depth\nof truth",
    speak: "Where words come out from the depth of truth.",
    voice: "en_US-lessac-medium",
    seconds: 9,
  },
  {
    id: "l5",
    line: "Where tireless striving\nstretches its arms\ntowards perfection",
    speak: "Where tireless striving stretches its arms towards perfection.",
    voice: "en_US-lessac-medium",
    seconds: 10,
  },
  {
    id: "l6",
    line: "Into that heaven\nof freedom,\nmy Father,\nlet my country awake.",
    speak: "Into that heaven of freedom, my Father, let my country awake.",
    voice: "en_US-lessac-medium",
    seconds: 10,
    accent: true,
  },
];

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const comp = composition({ width: 1080, height: 1920, fps: 30 });

BEATS.forEach((beat, i) => {
  const isTitle = i === 0;
  const isLast = i === BEATS.length - 1;

  comp.scene(
    {
      id: beat.id,
      duration: beat.seconds,
      background: BG,
      // The first scene has no neighbour to transition from.
      ...(isTitle ? {} : { transition: { type: i % 2 === 0 ? "fade" : "slideUp", duration: 0.6 } }),
    },
    (s) => {
      s.add(
        (isTitle ? Heading : Word)(beat.line, {
          y: "center-40",
          ...(beat.accent ? { color: ACCENT } : {}),
          animation: fadeIn(0.5),
        })
      );

      if (isTitle) {
        s.add(Sub("Rabindranath Tagore · Gitanjali 35", { y: "center+180", animation: fadeIn(0.6) }));
      }
      if (isLast) {
        s.add(Sub("— Gitanjali 35", { y: "center+260", color: ACCENT, animation: fadeIn(0.8) }));
      }

      // The voice-over for this beat.
      s.say(beat.speak, { voice: beat.voice, rate: 0.88 });
    }
  );
});

export default comp.build();
