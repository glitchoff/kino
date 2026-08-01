#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, compile } from "./render.js";
import { startStudio } from "../studio/server.js";
import type { KinoComposition } from "./types.js";

async function main() {
  const args = process.argv.slice(2);

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
    npx kino <json-file> [options]
    npx kino render <json-file> [options]
    npx kino studio [--port <number>]

  Commands:
    studio                 Launch Kino Studio web editor & preview server
    render <json-file>     Render JSON composition to video file

  Options:
    -o, --output <path>    Output video file path (default: ./out.mp4)
    -e, --encoder <name>   Video encoder (libx264, h264_nvenc, hevc_nvenc, h264_qsv, h264_amf, h264_videotoolbox, auto)
    --gpu                  Enable GPU hardware acceleration (alias for --encoder auto with CPU fallback)
    -p, --port <number>    Port for studio server (default: 3333)
    --dry-run              Print compiled FFmpeg command without rendering
    --verbose              Show full FFmpeg output logs during render
    -h, --help             Show help output
`);
    process.exit(0);
  }

  let jsonPath = "";
  let outputPath = "./out.mp4";
  let encoder: any = undefined;
  let isDryRun = false;
  let isVerbose = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "render") {
      continue;
    } else if (arg === "-o" || arg === "--output") {
      outputPath = args[++i] || "./out.mp4";
    } else if (arg === "-e" || arg === "--encoder") {
      encoder = args[++i];
    } else if (arg === "--gpu") {
      encoder = "auto";
    } else if (arg === "--dry-run") {
      isDryRun = true;
    } else if (arg === "--verbose") {
      isVerbose = true;
    } else if (!arg.startsWith("-") && !jsonPath) {
      jsonPath = arg;
    }
  }

  if (!jsonPath) {
    console.error("Error: Please provide a valid JSON input file or use `npx kino studio`.");
    process.exit(1);
  }

  try {
    const fullPath = resolve(process.cwd(), jsonPath);
    const fileContent = readFileSync(fullPath, "utf-8");
    const composition: KinoComposition = JSON.parse(fileContent);

    if (isDryRun) {
      const { args: ffmpegArgs } = compile(composition, { output: outputPath, encoder });
      console.log(`[kino dry-run] FFmpeg command:\nffmpeg ${ffmpegArgs.join(" ")}`);
      return;
    }

    console.log(`[kino] Rendering ${jsonPath} -> ${outputPath}...`);
    const result = await render(composition, {
      output: outputPath,
      verbose: isVerbose,
      encoder,
    });
    console.log(`[kino] Successfully rendered to ${result.output}`);
  } catch (err: any) {
    console.error(`[kino] Error: ${err.message}`);
    process.exit(1);
  }
}

main();
