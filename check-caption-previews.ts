// Render just the caption previews, to prove they build.
//
//   npx tsx check-caption-previews.ts
//
// `build-previews.mjs` requires a vendored Linux ffmpeg with drawtext. The
// bundled ffmpeg-static on this machine has drawtext too, so the caption clips
// can be checked here without that build. This renders the same compositions
// the docs script defines, into out/caption-previews/.
//
// A preview that throws at build time is worse than no preview, because CI
// fails on a page that reads fine locally — so each one is rendered, not just
// compiled.

import { mkdirSync } from "node:fs";
import { composition, captionElements, rect, render } from "./src/index.js";

// Must match `build-previews.mjs`, or this checks a different picture than the
// one the docs site shows.
const WIDTH = 960;
const HEIGHT = 540;
const FPS = 24;
const FFMPEG =
  "D:/Projects/Misc/kino/node_modules/.pnpm/ffmpeg-static@5.3.0/node_modules/ffmpeg-static/ffmpeg.exe";

type Word = { word: string; clean: string; start: number; end: number };

/**
 * Mirrors `captionClip` in docs-site/scripts/build-previews.mjs, including the
 * scaling from the presets' 1280px-tall portrait frame to this one. If the two
 * drift, this check passes on a clip nobody sees.
 */
function captionClip(options: Record<string, unknown>, words: Word[]) {
  const scale = HEIGHT / 1280;
  const sized: Record<string, unknown> = { ...options };
  if (typeof sized.fontSize === "number") {
    sized.fontSize = Math.max(18, Math.round(sized.fontSize * scale * 1.9));
  }
  const text = sized.text as { stroke?: { width: number | string } } | undefined;
  if (text?.stroke) {
    sized.text = {
      ...text,
      stroke: { ...text.stroke, width: Math.max(1, Math.round(Number(text.stroke.width) * scale * 1.9)) },
    };
  }

  return composition({ width: WIDTH, height: HEIGHT, fps: FPS })
    .scene({ duration: 3, background: "#111827" }, (s) => {
      s.add(rect({ width: WIDTH, height: 240, x: 0, y: HEIGHT / 2 - 120, fill: "#2a3446" }));
      s.addAll(captionElements(words as never, sized as never));
    })
    .build();
}

const w = (word: string, start: number, end: number): Word => ({
  word,
  clean: word.replace(/[^A-Za-z']/g, ""),
  start,
  end,
});

const CLIPS: Record<string, { options: Record<string, unknown>; words: Word[] }> = {
  "feature-caption-preset": {
    options: { preset: "shout" },
    words: [w("SHADY", 0.1, 0.9), w("MAN", 1.0, 1.8), w("BIZARRE", 1.9, 2.8)],
  },
  "feature-caption-shout-band": {
    options: { preset: "shout-band" },
    words: [
      w("Pallet", 0.1, 0.5), w("Town.", 0.55, 0.9), w("Two", 1.0, 1.25),
      w("hills,", 1.3, 1.7), w("a", 1.75, 1.85), w("few", 1.9, 2.2), w("houses.", 2.25, 2.8),
    ],
  },
  "feature-caption-plain": {
    options: { preset: "plain" },
    words: [
      w("The", 0.1, 0.3), w("boy", 0.32, 0.6), w("asked", 0.62, 0.9), w("Black", 0.95, 1.3),
      w("Jack", 1.32, 1.6), w("to", 1.62, 1.75), w("treat", 1.78, 2.1), w("his", 2.12, 2.3),
      w("mother", 2.32, 2.9),
    ],
  },
  "feature-caption-karaoke": {
    options: { style: "karaoke", fontSize: 30, y: "bottom-40" },
    words: [
      w("Karaoke", 0.1, 0.6), w("sweeps", 0.65, 1.1), w("the", 1.15, 1.35),
      w("word", 1.4, 1.75), w("being", 1.8, 2.15), w("spoken.", 2.2, 2.8),
    ],
  },
  "feature-caption-reveal": {
    options: { style: "reveal", fontSize: 30, y: "bottom-40" },
    words: [
      w("Words", 0.1, 0.45), w("appear", 0.5, 0.9), w("one", 0.95, 1.2), w("at", 1.25, 1.4),
      w("a", 1.45, 1.55), w("time", 1.6, 1.95), w("and", 2.0, 2.25), w("stay.", 2.3, 2.8),
    ],
  },
  "feature-caption-word": {
    options: { style: "word", fontSize: 40, y: "center" },
    words: [
      w("One", 0.1, 0.5), w("word", 0.55, 0.95), w("at", 1.0, 1.2), w("a", 1.25, 1.4),
      w("time.", 1.45, 2.4),
    ],
  },
};

mkdirSync("out/caption-previews", { recursive: true });

let failed = 0;
for (const [name, { options, words }] of Object.entries(CLIPS)) {
  try {
    await render(captionClip(options, words), {
      output: `D:/Projects/Misc/kino/out/caption-previews/${name}.mp4`,
      encoder: "auto",
      ffmpegPath: FFMPEG,
    });
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}: ${(err as Error).message.split("\n")[0]}`);
  }
}

console.log(failed === 0 ? "\nPASS - all caption previews build and render" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
