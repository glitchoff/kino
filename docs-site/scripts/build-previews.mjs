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

/**
 * One caption look, as a looping clip.
 *
 * Timings are written out by hand rather than measured from TTS: a preview has
 * no audio and is muted, so what matters is the look and the word rhythm, not
 * real speech sync. A dark panel stands in for artwork so the stroke and
 * highlight are visible against something other than flat black.
 */
const captionClip = (k, options, words) =>
  k
    .composition({ width: WIDTH, height: HEIGHT, fps: FPS })
    .scene({ duration: 3, background: "#111827" }, (s) => {
      // A mid-grey block behind the text, so white-on-stroke reads the way it
      // will over a real panel instead of against pure black.
      s.add(k.rect({ width: WIDTH, height: 120, x: 0, y: HEIGHT / 2 - 60, fill: "#2a3446" }));
      s.addAll(k.captionElements(words, options));
    })
    .build();

/**
 * One clip per feature that shipped after the first release, so every row in
 * the docs has something moving next to it. Each is the smallest composition
 * that shows the feature doing its actual job — not a mockup.
 *
 * `docs/previews/` holds the same list for the other direction: the docs link a
 * clip by name and `build-previews.mjs` has to provide it. A missing clip shows
 * as an empty box, so `check-previews.mjs` compares the two.
 */
const FEATURE_PREVIEWS = [
  {
    name: "feature-shapes",
    build: (k) =>
      k
        .composition({ width: WIDTH, height: HEIGHT, fps: FPS })
        .scene({ duration: 2, background: BG_A }, (s) => {
          s.add(k.rect({ width: 120, height: 80, x: 40, y: 60, fill: "#38bdf8", radius: 16 }));
          s.add(k.ellipse({ width: 90, height: 90, x: 200, y: 55, fill: "transparent", stroke: "#f472b6", strokeWidth: 6 }));
          s.add(k.line({ width: 160, height: 100, x: 40, y: 170, x1: 0, y1: 0, x2: 160, y2: 100, stroke: "#a3e635", strokeWidth: 6 }));
          s.add(k.rect({ width: 120, height: 80, x: 320, y: 60, fill: "#fb923c", radius: 40 }));
        })
        .build(),
  },
  {
    name: "feature-takumi",
    build: (k) =>
      k
        .composition({ width: WIDTH, height: HEIGHT, fps: FPS })
        .scene({ duration: 2, background: BG_A }, (s) => {
          s.tak(
            `<div style="display:flex;flex-direction:column;gap:12px;padding:28px;font-family:sans-serif">
               <div style="font-size:34px;font-weight:800;color:#38bdf8">No browser</div>
               <div style="font-size:18px;color:#cbd5e1">Rendered by Takumi in Rust</div>
             </div>`,
            { width: WIDTH, height: HEIGHT }
          );
        })
        .build(),
  },
  {
    name: "feature-grade-curves",
    build: (k) =>
      k
        .composition({ width: WIDTH, height: HEIGHT, fps: FPS })
        .scene({ duration: 2, background: "#000000" }, (s) => {
          // A grey ramp, then a contrast curve: the S-shape is what a curve does.
          for (let i = 0; i < 10; i++) {
            const v = Math.round((i / 9) * 255).toString(16).padStart(2, "0");
            s.add(k.rect({
              width: WIDTH / 20, height: HEIGHT, x: (i * WIDTH) / 10, y: 0,
              fill: `#${v}${v}${v}`,
              grade: { curves: { master: [[0, 0], [0.25, 0.12], [0.75, 0.88], [1, 1]] } },
            }));
          }
        })
        .build(),
  },
  {
    name: "feature-grade-balance",
    build: (k) =>
      k
        .composition({ width: WIDTH, height: HEIGHT, fps: FPS, grade: { balance: { shadows: [0.18, 0, 0.22], highlights: [0.15, 0.08, -0.12] } } })
        .scene({ duration: 2, background: "#3a3f4b" }, (s) => {
          label(s, "teal / orange", { fontSize: 30 });
        })
        .build(),
  },
  {
    name: "feature-blend",
    build: (k) =>
      k
        .composition({ width: WIDTH, height: HEIGHT, fps: FPS })
        .scene({ duration: 2, background: "#202060" }, (s) => {
          s.add(k.rect({ width: 260, height: 180, x: 110, y: 45, fill: "#f97316", blend: "screen" }));
          s.add(k.ellipse({ width: 150, height: 150, x: 240, y: 60, fill: "#22d3ee", blend: "multiply" }));
        })
        .build(),
  },
  {
    name: "feature-mask",
    build: (k) =>
      k
        .composition({ width: WIDTH, height: HEIGHT, fps: FPS })
        .scene({ duration: 2, background: "#0f172a" }, (s) => {
          s.add(k.rect({ width: WIDTH, height: HEIGHT, x: 0, y: 0, fill: "#f43f5e", mask: { shape: "ellipse", feather: 24 } }));
          s.add(k.rect({ width: WIDTH, height: HEIGHT, x: 0, y: 0, fill: "#38bdf8", mask: { shape: "linear", direction: "up" } }));
        })
        .build(),
  },
  {
    name: "feature-motion-blur",
    build: (k) =>
      k
        .composition({ width: WIDTH, height: HEIGHT, fps: FPS })
        .scene({ duration: 2, background: BG_A }, (s) => {
          s.add(k.rect({
            width: 60, height: 60, x: 0, y: 105, fill: "#a3e635",
            animation: { x: { from: -60, to: WIDTH, duration: 1.2, easing: "linear" } },
            motionBlur: 8,
          }));
        })
        .build(),
  },
  {
    name: "feature-keyframes",
    build: (k) =>
      k
        .composition({ width: WIDTH, height: HEIGHT, fps: FPS })
        .scene({ duration: 2, background: BG_A }, (s) => {
          s.add(k.rect({
            width: 80, height: 80, x: WIDTH / 2 - 40, y: HEIGHT / 2 - 40, fill: "#fbbf24",
            animation: {
              scale: {
                keyframes: [
                  { at: 0, value: 0.6, easing: "easeOutBack" },
                  { at: 0.45, value: 1.25 },
                  { at: 0.8, value: 1.0 },
                ],
              },
              y: { keyframes: [{ at: 0, value: 40, easing: "easeOutBounce" }, { at: 1.2, value: -40 }] },
            },
          }));
        })
        .build(),
  },
  {
    name: "feature-captions",
    build: (k) =>
      k
        .composition({ width: WIDTH, height: HEIGHT, fps: FPS })
        .scene({ duration: 3, background: "#111827" }, (s) => {
          s.text("Karaoke captions highlight the word being sung", {
            fontSize: 30, color: "#94a3b8", x: "center", y: "center",
            captionWords: [
              { word: "Karaoke", at: 0.2, duration: 0.6 },
              { word: "captions", at: 0.9, duration: 0.6 },
              { word: "highlight", at: 1.6, duration: 0.6 },
              { word: "the", at: 2.2, duration: 0.3 },
              { word: "word", at: 2.5, duration: 0.5 },
            ],
            highlight: "#38bdf8",
          });
        })
        .build(),
  },
  {
    // One clip per caption look, so the docs table has something moving beside
    // every row. Timings are written out rather than measured from TTS, because
    // a preview has no audio — the point is the look, not the sync.
    name: "feature-caption-preset",
    build: (k) =>
      captionClip(k, { preset: "shout" }, [
        { word: "SHADY", clean: "SHADY", start: 0.1, end: 0.9 },
        { word: "MAN", clean: "MAN", start: 1.0, end: 1.8 },
        { word: "BIZARRE", clean: "BIZARRE", start: 1.9, end: 2.8 },
      ]),
  },
  {
    name: "feature-caption-shout-band",
    build: (k) =>
      captionClip(k, { preset: "shout-band" }, [
        { word: "Pallet", clean: "Pallet", start: 0.1, end: 0.5 },
        { word: "Town.", clean: "Town", start: 0.55, end: 0.9 },
        { word: "Two", clean: "Two", start: 1.0, end: 1.25 },
        { word: "hills,", clean: "hills", start: 1.3, end: 1.7 },
        { word: "a", clean: "a", start: 1.75, end: 1.85 },
        { word: "few", clean: "few", start: 1.9, end: 2.2 },
        { word: "houses.", clean: "houses", start: 2.25, end: 2.8 },
      ]),
  },
  {
    name: "feature-caption-plain",
    build: (k) =>
      captionClip(k, { preset: "plain" }, [
        { word: "The", clean: "The", start: 0.1, end: 0.3 },
        { word: "boy", clean: "boy", start: 0.32, end: 0.6 },
        { word: "asked", clean: "asked", start: 0.62, end: 0.9 },
        { word: "Black", clean: "Black", start: 0.95, end: 1.3 },
        { word: "Jack", clean: "Jack", start: 1.32, end: 1.6 },
        { word: "to", clean: "to", start: 1.62, end: 1.75 },
        { word: "treat", clean: "treat", start: 1.78, end: 2.1 },
        { word: "his", clean: "his", start: 2.12, end: 2.3 },
        { word: "mother", clean: "mother", start: 2.32, end: 2.9 },
      ]),
  },
  {
    name: "feature-caption-karaoke",
    build: (k) =>
      captionClip(k, { style: "karaoke", fontSize: 30, y: "bottom-40" }, [
        { word: "Karaoke", clean: "Karaoke", start: 0.1, end: 0.6 },
        { word: "sweeps", clean: "sweeps", start: 0.65, end: 1.1 },
        { word: "the", clean: "the", start: 1.15, end: 1.35 },
        { word: "word", clean: "word", start: 1.4, end: 1.75 },
        { word: "being", clean: "being", start: 1.8, end: 2.15 },
        { word: "spoken.", clean: "spoken", start: 2.2, end: 2.8 },
      ]),
  },
  {
    name: "feature-caption-reveal",
    build: (k) =>
      captionClip(k, { style: "reveal", fontSize: 30, y: "bottom-40" }, [
        { word: "Words", clean: "Words", start: 0.1, end: 0.45 },
        { word: "appear", clean: "appear", start: 0.5, end: 0.9 },
        { word: "one", clean: "one", start: 0.95, end: 1.2 },
        { word: "at", clean: "at", start: 1.25, end: 1.4 },
        { word: "a", clean: "a", start: 1.45, end: 1.55 },
        { word: "time", clean: "time", start: 1.6, end: 1.95 },
        { word: "and", clean: "and", start: 2.0, end: 2.25 },
        { word: "stay.", clean: "stay", start: 2.3, end: 2.8 },
      ]),
  },
  {
    name: "feature-caption-word",
    build: (k) =>
      captionClip(k, { style: "word", fontSize: 40, y: "center" }, [
        { word: "One", clean: "One", start: 0.1, end: 0.5 },
        { word: "word", clean: "word", start: 0.55, end: 0.95 },
        { word: "at", clean: "at", start: 1.0, end: 1.2 },
        { word: "a", clean: "a", start: 1.25, end: 1.4 },
        { word: "time.", clean: "time", start: 1.45, end: 2.4 },
      ]),
  },
  {
    name: "feature-preview-api",
    build: (k) =>
      k
        .composition({ width: WIDTH, height: HEIGHT, fps: FPS })
        .scene({ duration: 2, background: BG_A }, (s) => label(s, "Preview.open()", { fontSize: 30 }))
        .build(),
  },
  {
    // Built with `scene()` and `merge()` rather than the chained builder, so
    // the clip is the thing the docs page claims: one scene value, merged
    // twice.
    name: "feature-scene-values",
    build: (k) => {
      const card = (heading, sub, bg) =>
        k.scene({ for: 1.5, bg }, [
          k.text(heading, { fontSize: 30, color: "#e2e8f0", x: "center", y: "center-24" }),
          k.text(sub, { fontSize: 16, color: "#94a3b8", x: "center", y: "center+28" }),
        ]);

      const chorus = card("chorus", "merged twice", BG_B);

      return {
        width: WIDTH,
        height: HEIGHT,
        fps: FPS,
        ...k.merge(
          card("intro", "scene({ for, bg }, [...])", BG_A),
          chorus,
          chorus,
          card("outro", "merge(intro, chorus, chorus)", BG_A)
        ),
      };
    },
  },
  {
    // The reusable pieces: a preset look, a group of elements, a repeated
    // scene, and variants sharing their props.
    name: "feature-reusable",
    build: (k) => {
      const Heading = k.withDefaults(
        k.text,
        k.preset({ fontSize: 30, color: "#e2e8f0", x: "center", stroke: { color: "#0f172a", width: 3 } })
      );
      const card = (heading, note) =>
        k.elements(
          Heading(heading, { y: "center-24" }),
          k.withOptions(k.text(note, { fontSize: 16 }), {
            color: "#94a3b8",
            x: "center",
            y: "center+28",
            animation: k.shift(k.fadeIn(0.3), 0.2),
          })
        );

      const [intro, chorus, outro] = k.variants({ for: 1.5, bg: BG_A }, [
        { id: "intro", elements: card("preset()", "one look, layered") },
        { id: "chorus", elements: card("repeat()", "merged twice"), transition: "fade" },
        { id: "outro", elements: card("variants()", "shared props"), transition: "fade" },
      ]);

      return { width: WIDTH, height: HEIGHT, fps: FPS, ...k.merge(intro, k.repeat(chorus, 2), outro) };
    },
  },
];

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

  // Feature clips take the library, since they use element factories.
  for (const { name, build } of FEATURE_PREVIEWS) {
    jobs.push({ name, build: () => build(kino) });
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
