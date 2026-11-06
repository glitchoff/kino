#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { render, compile } from "./pipeline/index.js";
import { PREVIEW_DEFAULT_HEIGHT } from "./types/index.js";
import { startStudio } from "../studio/server.js";
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

async function setupFFmpeg(): Promise<void> {
  const moduleDir = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
  const script = resolve(moduleDir, "../scripts/install-ffmpeg.mjs");
  console.log("[kino] Setting up ffmpeg...");
  const result = spawnSync(process.execPath, [script], { stdio: "inherit", timeout: 900000 });
  if (result.status !== 0) {
    console.error("[kino] ffmpeg setup failed. See the errors above.");
    process.exit(1);
  }
  console.log("[kino] ffmpeg is ready.");
}

/**
 * Load a composition from disk.
 *
 * - `.json`        parsed as JSON
 * - `.mjs` / `.js` imported as an ES module
 * - `.ts`          transpiled in-process, then imported (no extra dependency
 *                  required — uses Node's built-in type stripping where
 *                  available, falling back to a minimal strip for annotations)
 *
 * A module may `export default <composition | builder>`, or export a named
 * `composition` / `scene`. A function export is called (and awaited) so a
 * composition can be generated per run.
 */
async function loadComposition(fullPath: string): Promise<KinoComposition> {
  const ext = fullPath.slice(fullPath.lastIndexOf("."));
  const isModule = [".ts", ".mts", ".js", ".mjs"].includes(ext);

  if (!isModule) {
    return JSON.parse(readFileSync(fullPath, "utf-8")) as KinoComposition;
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
    } else if (target === "ffmpeg") {
      await setupFFmpeg();
    } else {
      console.error(`Error: Unknown setup target '${target}'. Usage: npx kino setup [browser|ffmpeg]`);
      process.exit(1);
    }
    return;
  }

  if (args.includes("studio")) {
    let port = 3333;
    const portIdx = args.findIndex((a) => a === "-p" || a === "--port");
    if (portIdx !== -1 && args[portIdx + 1]) {
      port = Number(args[portIdx + 1]) || 3333;
    }
    startStudio(port);
    return;
  }

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`
  🎥 kino - JSON to FFmpeg video compiler

  Usage:
    npx kino <file> [options]
    npx kino render <file> [options]
    npx kino studio [--port <number>]
    npx kino setup [browser|ffmpeg]

  Commands:
    studio                 Launch Kino Studio web editor & preview server
    setup [browser]        Download Chrome for HTML elements (no-op if already installed; also happens automatically on first HTML render)
    setup ffmpeg           Install/verify the bundled ffmpeg (downloads the drawtext-enabled Linux build; verifies ffmpeg-static elsewhere)
    render <file>          Render composition to video file

  File formats:
    .json                  JSON composition file
    .ts / .js / .mjs       Code composition, e.g. export default composition(...).build()
    .kino                  Pre-compiled .kino artifact (renders without recompiling)

  Options:
    -o, --output <path>    Output video file path (default: ./out.mp4)
    -e, --encoder <name>   Video encoder (libx264, h264_nvenc, hevc_nvenc, h264_qsv, h264_amf, h264_videotoolbox, auto)
    --preset <name>        Encoder preset (auto-detected when unset; e.g. NVENC p1-p7, x264 veryfast/slow, AMF speed/balanced/quality)
    --ffmpeg-path <path>   Use a specific ffmpeg binary instead of the bundled one
    --browser-path <path>  Use a specific Chromium/Chrome executable for HTML elements (disables automatic browser download)
    --gpu                  Enable GPU hardware acceleration (alias for --encoder auto with CPU fallback)
    -p, --port <number>    Port for studio server (default: 3333)
    --dry-run              Compile to a portable .kino artifact and print the FFmpeg command without rendering (remote assets are downloaded at compile time)
    --preview [height]     Fast preview render: downscale the output to <height>px tall (default 144) and encode with ultrafast. Layout-accurate, not text-legible above 144p.
    --no-asset-cache       Re-download remote assets instead of using the on-disk cache
    --asset-cache-dir <p>  Directory for the remote asset cache (default: ./.kino-cache)
    --unsafe-inline-text   Disable textfile delivery (text passed inline; apostrophes may render blank)
    --verbose              Show full FFmpeg output logs during render
    -h, --help             Show help output
`);
    process.exit(0);
  }

  let inputPath = "";
  let outputPath = "./out.mp4";
  let encoder: any = undefined;
  let preset: string | undefined = undefined;
  let ffmpegPath: string | undefined = undefined;
  let browserPath: string | undefined = undefined;
  let isDryRun = false;
  let isVerbose = false;
  let isUnsafeInlineText = false;
  let previewHeight: number | undefined = undefined;
  let assetCache = true;
  let assetCacheDir: string | undefined = undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "render") {
      continue;
    } else if (arg === "-o" || arg === "--output") {
      outputPath = args[++i] || "./out.mp4";
    } else if (arg === "--ffmpeg-path") {
      ffmpegPath = args[++i];
    } else if (arg === "--browser-path") {
      browserPath = args[++i];
    } else if (arg === "-e" || arg === "--encoder") {
      encoder = args[++i];
    } else if (arg === "--gpu") {
      encoder = "auto";
    } else if (arg === "--preset") {
      preset = args[++i];
    } else if (arg === "--dry-run") {
      isDryRun = true;
    } else if (arg === "--no-asset-cache") {
      assetCache = false;
    } else if (arg === "--asset-cache-dir") {
      assetCacheDir = args[++i];
    } else if (arg === "--preview") {
      // `--preview` alone = 144p; `--preview 480` = explicit height.
      const next = args[i + 1];
      if (next && /^\d+$/.test(next)) {
        previewHeight = Number(next);
        i++;
      } else {
        previewHeight = PREVIEW_DEFAULT_HEIGHT;
      }
    } else if (arg.startsWith("--preview=")) {
      const raw = arg.slice("--preview=".length);
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        console.error(`Error: --preview expects a height in pixels (got '${raw}').`);
        process.exit(1);
      }
      previewHeight = Math.round(parsed);
    } else if (arg === "--unsafe-inline-text") {
      isUnsafeInlineText = true;
    } else if (arg === "--verbose") {
      isVerbose = true;
    } else if (!arg.startsWith("-") && !inputPath) {
      inputPath = arg;
    }
  }

  if (!inputPath) {
    console.error("Error: Please provide a valid input file (.json or .kino) or use `npx kino studio`.");
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
      const result = await render(fullPath, {
        output: outputPath,
        verbose: isVerbose,
        encoder,
        preset,
        ffmpegPath,
        browserPath,
        unsafeInlineText: isUnsafeInlineText,
      });
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
      const { args: ffmpegArgs, kinoFilePath } = compile(composition, {
        output: outputPath,
        encoder,
        preset,
        unsafeInlineText: isUnsafeInlineText,
        preview: previewHeight,
        assetCache,
        assetCacheDir,
      });
      console.log(`[kino dry-run] Compiled portable .kino artifact: ${kinoFilePath}`);
      console.log(`[kino dry-run] FFmpeg command (relative paths, cwd = extraction dir):\nffmpeg ${ffmpegArgs.join(" ")}`);
      return;
    }

    console.log(`[kino] Rendering ${inputPath} -> ${outputPath}...`);
    const result = await render(composition, {
      output: outputPath,
      verbose: isVerbose,
      encoder,
      preset,
      ffmpegPath,
      browserPath,
      unsafeInlineText: isUnsafeInlineText,
      preview: previewHeight,
      assetCache,
      assetCacheDir,
    });
    console.log(`[kino] Successfully rendered to ${result.output}`);
  } catch (err: any) {
    console.error(`[kino] Error: ${err.message}`);
    process.exit(1);
  }
}

main();
