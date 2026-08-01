import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import ffmpegStatic from "ffmpeg-static";
import type { KinoComposition, RenderOptions, CompileResult, TextOverlay } from "./types.js";

function getFFmpegBinaryPath(customPath?: string): string {
  if (customPath) return customPath;
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  if (ffmpegStatic && typeof ffmpegStatic === "string" && existsSync(ffmpegStatic)) {
    return ffmpegStatic;
  }
  return "ffmpeg";
}

function normalizeColor(color?: string): string {
  if (!color) return "black";
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      return `0x${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
    }
    return `0x${hex}`;
  }
  return color;
}

function escapeDrawText(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "'\\\\''")
    .replace(/:/g, "\\:");
}

function formatPosition(val: number | string | undefined, defaultExpr: string): string {
  if (val === undefined || val === "center") {
    return defaultExpr;
  }
  if (typeof val === "number") {
    return String(val);
  }
  return val;
}

export function compile(composition: KinoComposition, options?: Partial<RenderOptions>): CompileResult {
  const width = composition.width || 1920;
  const height = composition.height || 1080;
  const duration = composition.duration || 5;
  const fps = composition.fps || 30;
  const bg = normalizeColor(composition.background);
  const output = options?.output || "./out.mp4";

  const colorSource = `color=c=${bg}:s=${width}x${height}:r=${fps}:d=${duration}`;

  // Gather text overlays
  const textItems: TextOverlay[] = [];
  if (composition.text) {
    if (Array.isArray(composition.text)) {
      textItems.push(...composition.text);
    } else {
      textItems.push(composition.text);
    }
  }
  if (composition.elements) {
    textItems.push(...composition.elements);
  }

  const filters: string[] = [];

  for (const item of textItems) {
    const textStr = escapeDrawText(item.content || "");
    const fontSize = item.fontSize ?? 48;
    const fontColor = item.fontColor ?? "white";
    const xExpr = formatPosition(item.x, "(w-text_w)/2");
    const yExpr = formatPosition(item.y, "(h-text_h)/2");

    let filter = `drawtext=text='${textStr}':fontsize=${fontSize}:fontcolor=${fontColor}:x=${xExpr}:y=${yExpr}`;

    if (item.fontFile) {
      filter += `:fontfile='${escapeDrawText(item.fontFile)}'`;
    }

    if (item.startTime !== undefined || item.duration !== undefined) {
      const start = item.startTime ?? 0;
      const end = item.duration !== undefined ? start + item.duration : duration;
      filter += `:enable='between(t\\,${start}\\,${end})'`;
    }

    filters.push(filter);
  }

  const args: string[] = ["-y", "-f", "lavfi", "-i", colorSource];

  let filtergraph: string | undefined;
  if (filters.length > 0) {
    filtergraph = filters.join(",");
    args.push("-vf", filtergraph);
  }

  args.push(
    "-t",
    String(duration),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    output
  );

  return { args, filtergraph };
}

export async function render(
  composition: KinoComposition,
  options: RenderOptions
): Promise<{ output: string }> {
  const ffmpegBin = getFFmpegBinaryPath(options.ffmpegPath);
  const { args } = compile(composition, options);

  if (options.verbose) {
    console.log(`[kino] Spawning: ${ffmpegBin} ${args.join(" ")}`);
  }

  return new Promise((resolve, reject) => {
    const process = spawn(ffmpegBin, args, { stdio: options.verbose ? "inherit" : "pipe" });

    let stderr = "";
    if (!options.verbose && process.stderr) {
      process.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    process.on("error", (err) => {
      reject(
        new Error(
          `Failed to start FFmpeg process (${ffmpegBin}). Error: ${err.message}`
        )
      );
    });

    process.on("close", (code) => {
      if (code === 0) {
        resolve({ output: options.output });
      } else {
        reject(
          new Error(
            `FFmpeg exited with code ${code}.\n${stderr ? `FFmpeg output:\n${stderr}` : ""}`
          )
        );
      }
    });
  });
}
