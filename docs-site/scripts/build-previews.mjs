/**
 * Renders the little loop that sits beside each feature in the docs.
 *
 * Every clip is a real composition put through the real pipeline, so a preview
 * cannot show something the engine does not do. They are deliberately tiny —
 * 480x270, a couple of seconds, no audio — because they play muted and looping
 * next to a table row.
 *
 *   node docs-site/scripts/build-previews.mjs
 *
 * Output goes to docs-site/public/previews/. The docs CI workflow runs this and
 * uploads the clips to a release, so they are not committed.
 */
import { mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "public", "previews");

const WIDTH = 480;
const HEIGHT = 270;
const FPS = 24;
const BG_A = "#141c30";
const BG_B = "#312e81";

/** Every transition the engine maps in `src/pipeline/transitions.ts`. */
const TRANSITIONS = [
  "fade",
  "slideLeft",
  "slideRight",
  "slideUp",
  "slideDown",
  "wipeLeft",
  "wipeRight",
  "wipeUp",
  "wipeDown",
  "zoomIn",
  "zoomOut",
];

/**
 * Animation helpers, as `{ name, animation }`. Kept literal rather than
 * generated so each clip can show the helper doing its actual job.
 */
const ANIMATIONS = [
  { name: "fadeIn", animation: { opacity: { from: 0, to: 1, duration: 0.6, easing: "easeOut" } } },
  { name: "fadeOut", animation: { opacity: { from: 1, to: 0, duration: 0.6, easing: "easeIn" } } },
  { name: "slideIn", animation: { x: { from: -160, to: 0, duration: 0.6, easing: "easeOut" } } },
  { name: "popIn", animation: { scale: { from: 0.8, to: 1, duration: 0.5, easing: "easeOut" } } },
];

const label = (s, content, extra = {}) =>
  s.text(content, {
    fontSize: 34,
    color: "#ffffff",
    x: "center",
    y: "center",
    ...extra,
  });

async function main() {
  // Imported by path: docs-site has its own node_modules, so the package
  // specifier would not resolve here. The library must be built first.
  let kino;
  try {
    kino = await import("../../dist/index.js");
  } catch {
    console.error(
      "Cannot load ../../dist/index.js — run `pnpm exec tsup` at the repo root first."
    );
    process.exit(1);
  }

  const { composition, render } = kino;
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  // `ffmpeg-static` ships without drawtext (no libharfbuzz), so the vendored
  // Linux build is required for anything with text. Every preview has text.
  const vendored = join(here, "..", "..", "vendor", "linux", process.arch, "ffmpeg");
  const ffmpegPath = existsSync(vendored) ? vendored : undefined;
  if (!ffmpegPath) {
    console.error(
      `No vendored ffmpeg at ${vendored}. Run \`node scripts/install-ffmpeg.mjs\` first.`
    );
    process.exit(1);
  }

  const jobs = [];

  for (const type of TRANSITIONS) {
    jobs.push({
      name: `transition-${type}`,
      build: () =>
        composition({ width: WIDTH, height: HEIGHT, fps: FPS })
          .scene({ duration: 1, background: BG_A }, (s) => label(s, "A"))
          .scene(
            { duration: 1.4, background: BG_B, transition: { type, duration: 0.6 } },
            (s) => label(s, "B")
          )
          .build(),
    });
  }

  for (const { name, animation } of ANIMATIONS) {
    jobs.push({
      name: `animation-${name}`,
      build: () =>
        composition({ width: WIDTH, height: HEIGHT, fps: FPS })
          .scene({ duration: 1.6, background: BG_A }, (s) =>
            label(s, name, { animation })
          )
          .build(),
    });
  }

  for (const job of jobs) {
    const output = join(outDir, `${job.name}.mp4`);
    process.stdout.write(`  ${job.name} … `);
    try {
      await render(job.build(), { output, verbose: false, ffmpegPath });
      console.log("ok");
    } catch (err) {
      console.log("FAILED");
      console.error(`    ${err?.message ?? err}`);
      process.exitCode = 1;
    }
  }

  console.log(`\n${jobs.length} previews in ${outDir}`);
}

main();
