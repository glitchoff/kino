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
