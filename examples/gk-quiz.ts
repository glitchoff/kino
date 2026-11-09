/**
 * GK Quiz — the vertical quiz-card short.
 *
 * Three questions. For each one: the question is boxed in red while a Hindi
 * voice reads it and its three options, a four-second timer runs beside them,
 * then the correct option is ticked in green and the voice confirms it.
 *
 * The audio is the clock. Every scene is sized from its measured voice-over
 * (`for: { fit: voice }`), so the timer and the reveal land on the words rather
 * than on a guessed number of seconds. Change a line of speech and the whole
 * card re-times itself.
 *
 * Fonts and photos are fetched, not committed:
 *
 *   node scripts/fetch-example-assets.mjs gk-quiz
 *   npx kino examples/gk-quiz.ts -o out/gk-quiz.mp4
 *
 * Requires Piper on PATH (`pip install piper-tts`). The Hindi voice downloads
 * on first render (~63 MB, cached globally).
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  animate,
  composition,
  ellipse,
  fadeIn,
  line,
  popIn,
  rect,
  scene,
  text,
  voice,
  withDefaults,
} from "@glitchoff/kino";

// Absolute, because `exportComposition()` stages its inputs from a temporary
// working directory: a relative asset path is resolved against *that* dir by
// ffmpeg, not against the repo, and fails to open.
const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), "assets");

const W = 1080;
const H = 1920;
const VOICE = "hi_IN-priyamvada";

// ---------------------------------------------------------------------------
// Look
// ---------------------------------------------------------------------------

const PAPER = "#f7f9fc";
const INK = "#0f172a";
const MUTED = "#475569";
const BLUE = "#2563eb";
const YELLOW = "#facc15";
const GREEN = "#16a34a";
const RED = "#ef4444";

const DEV_BOLD = join(ASSETS, "NotoSansDevanagari-Bold.ttf");
const DEV_REG = join(ASSETS, "NotoSansDevanagari-Regular.ttf");
const LATIN_BOLD = join(ASSETS, "NotoSans-Bold.ttf");

/** Devanagari needs its own font: Noto Sans carries no Devanagari glyphs. */
const Question = withDefaults(text, {
  fontSize: 46,
  color: INK,
  fontFile: DEV_BOLD,
  x: 190,
  maxWidth: 800,
  lineHeight: 1.22,
  textAlign: "left",
});

const Option = withDefaults(text, {
  fontSize: 40,
  color: INK,
  fontFile: DEV_REG,
  x: 190,
  maxWidth: 580,
  textAlign: "left",
});

const Latin = withDefaults(text, {
  fontSize: 40,
  color: INK,
  fontFile: LATIN_BOLD,
  x: "center",
  textAlign: "center",
});

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

interface Quiz {
  id: string;
  /** The question as drawn. */
  prompt: string;
  /** The question as spoken — with the option letters, which are drawn as labels. */
  promptSpeech: string;
  options: [string, string, string];
  answer: 0 | 1 | 2;
  revealSpeech: string;
  photo: string;
  photoNote: string;
}

const QUESTIONS: Quiz[] = [
  {
    id: "q1",
    prompt: "भारत में सबसे पहले\nकिस धातु का\nइस्तेमाल किया गया था?",
    promptSpeech:
      "सवाल नंबर एक। भारत में सबसे पहले किस धातु का इस्तेमाल किया गया था? एक, लोहा। दो, सोना। तीन, ताँबा।",
    options: ["लोहा", "सोना", "ताँबा"],
    answer: 2,
    revealSpeech:
      "सही जवाब है ताँबा। ताँबा ही पहली धातु थी जिसे भारत में पिघलाया और इस्तेमाल किया गया।",
    photo: join(ASSETS, "q1-copper.jpg"),
    photoNote: "ताँबा",
  },
  {
    id: "q2",
    prompt: "महात्मा गांधी का\nजन्म कहाँ\nहुआ था?",
    promptSpeech:
      "सवाल नंबर दो। महात्मा गांधी का जन्म कहाँ हुआ था? एक, अहमदाबाद। दो, राजकोट। तीन, पोरबंदर।",
    options: ["अहमदाबाद", "राजकोट", "पोरबंदर"],
    answer: 2,
    revealSpeech: "सही जवाब है पोरबंदर। दो अक्टूबर अठारह सौ उनहत्तर को, गुजरात के पोरबंदर में।",
    photo: join(ASSETS, "q2-gandhi.jpg"),
    photoNote: "महात्मा गांधी",
  },
  {
    id: "q3",
    prompt: "भारत में पहली यात्री\nरेलगाड़ी किन दो\nस्थानों के बीच चली थी?",
    promptSpeech:
      "सवाल नंबर तीन। भारत में पहली यात्री रेलगाड़ी किन दो स्थानों के बीच चली थी? एक, दिल्ली से आगरा। दो, मुंबई से ठाणे। तीन, चेन्नई से बेंगलुरु।",
    options: ["दिल्ली से आगरा", "मुंबई से ठाणे", "चेन्नई से बेंगलुरु"],
    answer: 1,
    revealSpeech:
      "सही जवाब है मुंबई से ठाणे। सोलह अप्रैल अठारह सौ तिरपन को, चौंतीस किलोमीटर का सफ़र।",
    photo: join(ASSETS, "q3-train.jpg"),
    photoNote: "भाप का इंजन",
  },
];

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** The GK QUIZ badge: a yellow disc, rays around it, and the wordmark. */
function logo(y: number, scale = 1) {
  const r = 74 * scale;
  const rays = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2;
    const inner = r + 18 * scale;
    const outer = r + 36 * scale;
    return line({
      width: 120 * scale,
      height: 120 * scale,
      x: W / 2 - 60 * scale,
      y: y - 60 * scale,
      x1: 60 * scale + Math.cos(a) * inner,
      y1: 60 * scale + Math.sin(a) * inner,
      x2: 60 * scale + Math.cos(a) * outer,
      y2: 60 * scale + Math.sin(a) * outer,
      stroke: INK,
      strokeWidth: 7 * scale,
    });
  });

  return [
    ...rays,
    ellipse({ width: r * 2, height: r * 2, x: W / 2 - r, y: y - r, fill: YELLOW, stroke: INK, strokeWidth: 6 * scale }),
    Latin("GK", { fontSize: 60 * scale, y: y - 34 * scale }),
    Latin("QUIZ", { fontSize: 24 * scale, y: y + 22 * scale }),
  ];
}

/** The blue numbered disc beside each question. */
function numberBadge(n: number, y: number) {
  return [
    ellipse({ width: 104, height: 104, x: 46, y, fill: BLUE }),
    Latin(String(n), { fontSize: 58, color: "#ffffff", x: 98, y: y + 76 }),
  ];
}

/** A red box that grows around the question while it is read. */
function highlightBox(y: number, height: number, seconds: number) {
  return rect({
    width: 862,
    height,
    x: 168,
    y,
    stroke: RED,
    strokeWidth: 6,
    radius: 8,
    animation: { scale: animate({ from: 0.02, to: 1, duration: Math.min(0.45, seconds), easing: "easeOut" }) },
  });
}

/**
 * The countdown, beside the options.
 *
 * A red disc drains under a white ring, which reads as a timer without the
 * conic-gradient mask the shape rasteriser does not have.
 */
function timer(x: number, y: number, seconds: number, startAt: number) {
  const R = 56;
  return [
    ellipse({
      width: R * 2,
      height: R * 2,
      x,
      y,
      fill: RED,
      startAt,
      animation: { opacity: fadeIn(0.01), scale: animate({ from: 1, to: 0, duration: seconds, easing: "linear" }) },
    }),
    ellipse({
      width: R * 2,
      height: R * 2,
      x,
      y,
      fill: "#ffffff",
      stroke: INK,
      strokeWidth: 5,
      startAt,
      animation: { opacity: fadeIn(0.2) },
    }),
    Latin("?", { fontSize: 58, x: x + R, y: y + R + 22, startAt, animation: { opacity: fadeIn(0.2) } }),
  ];
}

/** A radio circle, plus a green tick on the correct option. */
function radio(x: number, y: number, correct: boolean) {
  const R = 26;
  const circle = ellipse({ width: R * 2, height: R * 2, x, y, fill: "#ffffff", stroke: INK, strokeWidth: 4 });
  if (!correct) return [circle];
  return [
    circle,
    line({ width: 80, height: 80, x: x - 14, y: y - 14, x1: 26, y1: 40, x2: 42, y2: 58, stroke: GREEN, strokeWidth: 10 }),
    line({ width: 80, height: 80, x: x - 14, y: y - 14, x1: 42, y1: 58, x2: 70, y2: 18, stroke: GREEN, strokeWidth: 10 }),
  ];
}

// ---------------------------------------------------------------------------
// The cards
// ---------------------------------------------------------------------------

const QUESTION_Y = 300;
const OPTION_YS = [QUESTION_Y + 260, QUESTION_Y + 344, QUESTION_Y + 428];
const PHOTO_Y = 780;
const PHOTO_H = 520;
const TIMER_SECONDS = 4;

/**
 * A scene carries its speech as `narration`, which is what the builder's
 * `s.say()` produces; `scene()` has no `say()` of its own.
 */
function withSpeech(s: ReturnType<typeof scene>, spoken: Awaited<ReturnType<typeof voice>>) {
  return { ...s, narration: [spoken.spec] };
}

async function askScene(q: Quiz, n: number) {
  const spoken = await voice(q.promptSpeech, { voice: VOICE });
  const askLength = spoken.seconds + 0.3;

  const s = scene({ id: `${q.id}-ask`, for: askLength + TIMER_SECONDS, bg: PAPER }, [
    ...logo(120),
    ...numberBadge(n, QUESTION_Y - 4),
    Question(q.prompt, { y: QUESTION_Y, animation: { opacity: fadeIn(0.35) } }),
    highlightBox(QUESTION_Y - 26, 214, askLength),

    ...q.options.flatMap((label, i) => [
      ...radio(190, OPTION_YS[i]! + 6, false),
      Option(label, { y: OPTION_YS[i]!, startAt: 0.5 + i * 0.12, animation: { opacity: fadeIn(0.3) } }),
    ]),

    {
      type: "image" as const,
      src: q.photo,
      width: 470,
      height: PHOTO_H,
      x: 560,
      y: PHOTO_Y,
      fit: "cover" as const,
      startAt: 0.25,
      animation: { opacity: fadeIn(0.5) },
    },
    text(q.photoNote, {
      fontSize: 28,
      color: MUTED,
      fontFile: DEV_REG,
      x: "center",
      y: PHOTO_Y + PHOTO_H + 20,
      startAt: 0.45,
      animation: { opacity: fadeIn(0.4) },
    }),

    ...timer(590, QUESTION_Y + 348, TIMER_SECONDS, askLength),
  ]);

  return withSpeech(s, spoken);
}

async function answerScene(q: Quiz, n: number) {
  const spoken = await voice(q.revealSpeech, { voice: VOICE });
  const correctY = OPTION_YS[q.answer]!;

  const s = scene({ id: `${q.id}-answer`, for: { fit: spoken, pad: 1.2 }, bg: PAPER }, [
    ...logo(120),
    ...numberBadge(n, QUESTION_Y - 4),
    Question(q.prompt, { y: QUESTION_Y }),

    rect({
      width: 660,
      height: 78,
      x: 160,
      y: correctY - 14,
      fill: "#dcfce7",
      radius: 14,
      animation: { opacity: fadeIn(0.3) },
    }),

    ...q.options.flatMap((label, i) => [
      ...radio(190, OPTION_YS[i]! + 6, i === q.answer),
      Option(label, { y: OPTION_YS[i]!, color: i === q.answer ? GREEN : MUTED }),
    ]),

    text(`जवाब: ${q.options[q.answer]}`, {
      fontSize: 46,
      color: GREEN,
      fontFile: DEV_BOLD,
      x: "center",
      y: 1240,
      startAt: 0.4,
      animation: { opacity: fadeIn(0.35) },
    }),

    {
      type: "image" as const,
      src: q.photo,
      width: 470,
      height: PHOTO_H,
      x: 560,
      y: PHOTO_Y,
      fit: "cover" as const,
      animation: { opacity: fadeIn(0.4) },
    },
  ]);

  return withSpeech(s, spoken);
}

// ---------------------------------------------------------------------------
// The video
// ---------------------------------------------------------------------------

// A short reel: no title card and no sign-off, straight into the first question.
// The question is read, a four-second timer runs, the answer is revealed, and
// the next question follows.
const cards = [];
for (const [i, q] of QUESTIONS.entries()) {
  cards.push(await askScene(q, i + 1), await answerScene(q, i + 1));
}

const comp = composition({ width: W, height: H, fps: 30 });
for (const card of cards) comp.scene(card);

export default comp.build();
