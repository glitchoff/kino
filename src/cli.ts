#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render, compile } from "./render.js";
import { startStudio } from "../studio/server.js";
import type { KinoComposition } from "./types.js";

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
    let composition: KinoComposition;

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

    const fileContent = readFileSync(fullPath, "utf-8");
    composition = JSON.parse(fileContent) as KinoComposition;

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
    });
    console.log(`[kino] Successfully rendered to ${result.output}`);
  } catch (err: any) {
    console.error(`[kino] Error: ${err.message}`);
    process.exit(1);
  }
}

main();
