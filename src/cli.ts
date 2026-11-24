#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { render, compile } from "./pipeline/index.js";
import { renderTakumiElements } from "./pipeline/elements/takumi-elements.js";
import { parseRenderArgs, RENDER_FLAGS } from "./cli-args.js";
import { replaceTtsWithPlaceholders } from "./tts/resolve.js";
import type { KinoComposition } from "./types/index.js";

async function setupBrowser(): Promise<void> {
  const moduleDir = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
  const script = resolve(moduleDir, "../scripts/install-browser.mjs");
  console.log("[kino] Setting up Chrome for HTML elements...");
  const result = spawnSync(process.execPath, [script], { stdio: "inherit", timeout: 600000 });
  if (result.status !== 0) {
    console.error("[kino] Browser setup failed. See the errors above.");
    process.exit(1);
  }
  console.log("[kino] HTML elements are ready to render.");
}

async function setupObscura(): Promise<void> {
  const moduleDir = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
  const script = resolve(moduleDir, "../scripts/install-obscura.mjs");
  console.log("[kino] Setting up Obscura for HTML elements...");
  const result = spawnSync(process.execPath, [script], { stdio: "inherit", timeout: 900000 });
  if (result.status !== 0) {
    console.error("[kino] Obscura setup failed. See the errors above.");
    process.exit(1);
  }
}

/**
 * Download the optional `gpucap` text renderer for this platform.
 *
 * Not a hard requirement: without it captions render with `drawtext`, which is
 * what they did before this existed. The installer reports that clearly and
 * exits 0 rather than failing a setup run for a feature nobody asked for.
 */
async function setupGpuCap(): Promise<void> {
  const moduleDir = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
  const script = resolve(moduleDir, "../scripts/install-gpucap.mjs");
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(process.execPath, [script], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error("[kino] gpucap setup failed. See the errors above.");
    process.exit(1);
  }
  const { resolveGpuCap } = await import("./captions/gpu.js");
  const found = resolveGpuCap();
  if (found) {
    console.log(`\n  gpucap ready: ${found}`);
    console.log("  Opt in per caption:  captions(line, { render: \"gpu\" })");
  } else {
    console.log("\n  gpucap is not installed. Captions will use drawtext.");
  }
}

async function setupFFmpeg(): Promise<void> {  const moduleDir = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
  const script = resolve(moduleDir, "../scripts/install-ffmpeg.mjs");
  console.log("[kino] Setting up ffmpeg...");
  const result = spawnSync(process.execPath, [script], { stdio: "inherit", timeout: 900000 });
  if (result.status !== 0) {
    console.error("[kino] ffmpeg setup failed. See the errors above.");
    process.exit(1);
  }
  console.log("[kino] ffmpeg is ready.");
}

async function setupTts(): Promise<void> {
  const { isPiperAvailable, describeVoices, defaultVoiceDir, ensureVoice, resolveVoice, KNOWN_VOICES } = await import(
    "./tts/piper.js"
  );

  console.log("[kino] Checking for Piper...");
  if (!isPiperAvailable()) {
    console.error(
      "[kino] Piper is not installed.\n" +
        "  Install it with:  pip install piper-tts\n" +
        "  Then re-run:      npx kino setup tts"
    );
    process.exit(1);
  }
  console.log("[kino] Piper found on PATH.\n");

  console.log(`Available voices:\n${describeVoices()}\n`);
  console.log(`Voices are downloaded on first use into ${defaultVoiceDir()}`);

  // `kino setup tts <voice>` downloads that voice now instead of at render time.
  const requested = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  // Drop the `setup` and `tts` subcommand words themselves.
  const voices = requested.slice(2);
  for (const id of voices) {
    const spec = resolveVoice(id);
    console.log(`[kino] Downloading ${spec.id} (${spec.languageName})...`);
    await ensureVoice(spec);
    console.log(`[kino] ${spec.id} is ready.`);
  }
  if (!voices.length) {
    console.log("\n  Download one now:  npx kino setup tts " + Object.keys(KNOWN_VOICES)[0]);
  }
}

/**
 * Prepares word-level caption alignment.
 *
 * The aligner itself is an optional dependency; this installs it if needed and
 * then loads it, which downloads and caches the ONNX model so the first render
 * with captions does not stall on a 317 MB fetch.
 */
async function setupCaptions(): Promise<void> {
  const { isAlignmentAvailable, defaultCaptionCacheDir } = await import("./captions/index.js");

  if (!(await isAlignmentAvailable())) {
    // The aligner is installed into Kino's own cache, not the project. That
    // keeps it a capability rather than a dependency: no manifest, no
    // lockfile, and one copy shared by every project on the machine. It also
    // means pnpm, npm and yarn projects all behave the same.
    const { installAligner } = await import("./captions/index.js");
    console.log("[kino] Installing the optional aligner 'mms-forced-align'...");
    try {
      await installAligner();
    } catch (err: any) {
      console.error(
        `[kino] Could not install 'mms-forced-align': ${err.message}\n` +
          `  Captions still work without it, using even word timing.`
      );
      process.exit(1);
    }
  }

  console.log("[kino] Loading the alignment model (downloads ~317 MB on first use)...");
  const { warmAlignmentModel } = await import("./captions/index.js");
  await warmAlignmentModel();
  console.log(`[kino] Captions are ready. Model cached in ${defaultCaptionCacheDir()}`);
}

/**
 * Load a composition from disk.
 *
 * - `.mjs` / `.js` imported as an ES module
 * - `.ts`          transpiled in-process, then imported (no extra dependency
 *                  required — uses Node's built-in type stripping where
 *                  available, falling back to a minimal strip for annotations)
 *
 * A module may `export default <composition | builder>`, or export a named
 * `composition` / `scene`. A function export is called (and awaited) so a
 * composition can be generated per run.
 *
 * `.json` compositions are not supported. A composition is authored in code so
 * that options are typed, defaults are resolved, and helper functions like
 * `voice()` can be awaited; a JSON file bypasses all of that.
 */
async function loadComposition(fullPath: string): Promise<KinoComposition> {
  const ext = fullPath.slice(fullPath.lastIndexOf("."));
  const isModule = [".ts", ".mts", ".js", ".mjs"].includes(ext);

  if (!isModule) {
    throw new Error(
      `${fullPath} is not a composition file. kino reads .ts, .mts, .js and .mjs; ` +
        `JSON compositions are not supported.`
    );
  }

  const mod = await import(pathToFileURL(fullPath).href);
  const candidate = mod.default ?? mod.composition ?? mod.scene;

  if (candidate === undefined) {
    throw new Error(
      `${fullPath} must export a composition — use \`export default composition(...).build()\` (or a named \`composition\` export).`
    );
  }

  let value = typeof candidate === "function" ? await candidate() : candidate;
  // A builder instance is accepted directly; `build()` produces the plain object.
  if (value && typeof value.build === "function" && !Array.isArray(value.scenes)) {
    value = value.build();
  }

  if (!value || typeof value !== "object" || !Array.isArray(value.scenes)) {
    throw new Error(`${fullPath} did not resolve to a composition object with a \`scenes\` array.`);
  }

  return value as KinoComposition;
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "setup") {
    const target = args[1] ?? "browser";
    if (target === "browser") {
      await setupBrowser();
    } else if (target === "obscura") {
      await setupObscura();
    } else if (target === "ffmpeg") {
      await setupFFmpeg();
    } else if (target === "tts") {
      await setupTts();
    } else if (target === "captions") {
      await setupCaptions();
    } else {
      console.error(`Error: Unknown setup target '${target}'. Usage: npx kino setup [browser|obscura|ffmpeg|tts|captions|gpucap]`);
      process.exit(1);
    }
    return;
  }

  if (args[0] === "preview" || args[0] === "serve") {
    const file = args.slice(1).find((a) => !a.startsWith("-"));
    if (!file) {
      console.error("Usage: npx kino preview <composition.ts> [--port <n>] [--height <px>]");
      process.exit(1);
    }

    const portIdx = args.findIndex((a) => a === "-p" || a === "--port");
    const port = portIdx !== -1 && args[portIdx + 1] ? Number(args[portIdx + 1]) || 3333 : 3333;
    const heightIdx = args.findIndex((a) => a === "--height");
    const height = heightIdx !== -1 && args[heightIdx + 1] ? Number(args[heightIdx + 1]) || 360 : 360;

    const fullPath = resolve(file);
    const composition = await loadComposition(fullPath);
    const { serve } = await import("./pipeline/serve.js");
    // Held open until the process is killed; a watcher restarting the process
    // is how a source change reaches the browser.
    await serve(composition, { port, height });
    return;
  }

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`
  🎥 kino - code to FFmpeg video compiler

  Usage:
    npx kino <file> [options]
    npx kino render <file> [options]
    npx kino preview <file> [--port <number>] [--height <px>]
    npx kino setup [browser|ffmpeg|tts|captions|gpucap]

  Commands:
    preview <file>         Serve a live preview: scrub by seeking a proxy, or render a playable mp4
    setup [browser]        Download Chrome for HTML elements (no-op if already installed; also happens automatically on first HTML render)
    setup ffmpeg           Install/verify the bundled ffmpeg (downloads the drawtext-enabled Linux build; verifies ffmpeg-static elsewhere)
    setup tts [voice]      Check for Piper and download a voice (pip install piper-tts first)
    setup captions         Install the optional aligner and download its model (~317 MB, for word-perfect captions)
    setup gpucap           Download the optional GPU text renderer (~10 MB, for render: "gpu" captions)
    render <file>          Render composition to video file

  File formats:
    .ts / .js / .mjs       Code composition, e.g. export default composition(...).build()
    .kino                  Pre-compiled .kino artifact (renders without recompiling)

  Options:
`);

  for (const [flag, description] of RENDER_FLAGS) {
    console.log(`    ${flag.padEnd(23)}${description}`);
  }
  console.log(`    -p, --port <number>    Port for the preview server (default: 3333)
    --height <px>          Preview proxy height (default: 360)
`);
    process.exit(0);
  }

  const parsed = parseRenderArgs(args);
  const inputPath = parsed.input ?? "";
  const opts = parsed.options;
  const outputPath = opts.output ?? "./out.mp4";
  const isDryRun = parsed.dryRun;
  const isVerbose = opts.verbose ?? false;
  const isUnsafeInlineText = opts.unsafeInlineText ?? false;

  if (!inputPath) {
    console.error("Error: Please provide a valid input file (.ts, .js, .mjs or .kino) or use `npx kino preview <file>`.");
    process.exit(1);
  }

  const fullPath = resolve(process.cwd(), inputPath);
  const ext = fullPath.slice(-5);
  const isKinoFile = ext === ".kino";

  if (isKinoFile && isDryRun) {
    console.error("Error: --dry-run is not applicable to .kino files (they are already compiled artifacts).");
    process.exit(1);
  }

  try {
    if (isKinoFile) {
      console.log(`[kino] Rendering pre-compiled artifact ${inputPath} -> ${outputPath}...`);
      const result = await render(fullPath, { ...opts, output: outputPath });
      console.log(`[kino] Successfully rendered to ${result.output}`);
      return;
    }

    const composition = await loadComposition(fullPath);

    if (isUnsafeInlineText) {
      console.warn(
        "[kino] Warning: --unsafe-inline-text disables textfile delivery; text with apostrophes may render blank on some platforms."
      );
    }

    if (isDryRun) {
      // Dry runs must not download voices or spawn piper, so TTS sources are
      // shown as a placeholder in the command instead of being synthesised.
      const dryComposition = replaceTtsWithPlaceholders(composition);
      // `tak:` elements are rendered by Takumi before `compile()` runs, because
      // compile() is synchronous and Takumi is not. A dry run has to do the same
      // work or it fails on any composition using `s.tak()`.
      const takumi = await renderTakumiElements(dryComposition);
      let compiled: ReturnType<typeof compile>;
      try {
        compiled = compile(dryComposition, { ...opts, takumiRenders: takumi.paths });
      } finally {
        // compile() has copied the PNGs into the .kino by now.
        takumi.cleanup();
      }
      const { args: ffmpegArgs, kinoFilePath } = compiled;
      console.log(`[kino dry-run] Compiled portable .kino artifact: ${kinoFilePath}`);
      console.log(`[kino dry-run] FFmpeg command (relative paths, cwd = extraction dir):\nffmpeg ${ffmpegArgs.join(" ")}`);
      return;
    }

    console.log(`[kino] Rendering ${inputPath} -> ${outputPath}...`);
    const result = await render(composition, { ...opts, output: outputPath });
    console.log(`[kino] Successfully rendered to ${result.output}`);
  } catch (err: any) {
    console.error(`[kino] Error: ${err.message}`);
    process.exit(1);
  }
}

main();
