import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import ffmpegStatic from "ffmpeg-static";
import { normalizeComposition } from "./normalize.js";
import type {
  KinoComposition,
  RenderOptions,
  CompileResult,
  TextElement,
  ImageElement,
  AudioTrack,
} from "./types.js";

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

function escapeFFmpegStr(str: string): string {
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
  const norm = normalizeComposition(composition);
  const { width, height, duration, fps } = norm;
  const output = options?.output || "./out.mp4";

  const inputs: string[] = [];
  const filterComplex: string[] = [];

  let lastVideoPad = "0:v";

  // 1. Setup Base Background Input
  if (norm.background.type === "color") {
    const bgHex = normalizeColor(norm.background.value);
    const colorSource = `color=c=${bgHex}:s=${width}x${height}:r=${fps}:d=${duration}`;
    inputs.push("-f", "lavfi", "-i", colorSource);
  } else if (norm.background.type === "gradient") {
    const from = normalizeColor(norm.background.from);
    const to = normalizeColor(norm.background.to);
    const gradSource = `gradients=c0=${from}:c1=${to}:s=${width}x${height}:r=${fps}:d=${duration}`;
    inputs.push("-f", "lavfi", "-i", gradSource);
  } else if (norm.background.type === "image") {
    inputs.push("-loop", "1", "-i", norm.background.src);
    filterComplex.push(`[0:v]scale=${width}:${height}[bg_scaled]`);
    lastVideoPad = "[bg_scaled]";
  } else if (norm.background.type === "video") {
    if (norm.background.loop) {
      inputs.push("-stream_loop", "-1");
    }
    inputs.push("-i", norm.background.src);
    filterComplex.push(`[0:v]scale=${width}:${height}[bg_scaled]`);
    lastVideoPad = "[bg_scaled]";
  }

  let inputIndex = 1;

  // 2. Separate Image Elements vs Text Elements
  const imageElements: ImageElement[] = [];
  const textElements: TextElement[] = [];

  for (const elem of norm.elements) {
    if (elem.type === "image") {
      imageElements.push(elem);
    } else {
      textElements.push(elem as TextElement);
    }
  }

  // Process Image Overlay Inputs
  for (let i = 0; i < imageElements.length; i++) {
    const img = imageElements[i];
    inputs.push("-i", img.src);
    const currInputIdx = inputIndex++;
    const scaledPad = `[img_scaled_${i}]`;
    const outPad = `[v_over_${i}]`;

    const imgW = img.width || -1;
    const imgH = img.height || -1;

    filterComplex.push(`[${currInputIdx}:v]scale=${imgW}:${imgH}${scaledPad}`);

    const xExpr = formatPosition(img.x, "(main_w-overlay_w)/2");
    const yExpr = formatPosition(img.y, "(main_h-overlay_h)/2");

    let overlayFilter = `overlay=x=${xExpr}:y=${yExpr}`;
    if (img.startTime !== undefined || img.duration !== undefined) {
      const start = img.startTime ?? 0;
      const end = img.duration !== undefined ? start + img.duration : duration;
      overlayFilter += `:enable='between(t\\,${start}\\,${end})'`;
    }

    const inPad = lastVideoPad.startsWith("[") ? lastVideoPad : `[${lastVideoPad}]`;
    filterComplex.push(`${inPad}${scaledPad}${overlayFilter}${outPad}`);
    lastVideoPad = outPad;
  }

  // 3. Process Text Element Filters
  const textDrawFilters: string[] = [];
  for (const item of textElements) {
    const textStr = escapeFFmpegStr(item.content || "");
    const fontSize = item.fontSize ?? 48;
    const fontColor = item.fontColor ?? "white";
    const xExpr = formatPosition(item.x, "(w-text_w)/2");
    const yExpr = formatPosition(item.y, "(h-text_h)/2");

    let filter = `drawtext=text='${textStr}':fontsize=${fontSize}:fontcolor=${fontColor}:x=${xExpr}:y=${yExpr}`;

    if (item.box) {
      const boxColor = item.boxColor || "black@0.5";
      const boxPadding = item.boxPadding ?? 10;
      filter += `:box=1:boxcolor=${boxColor}:boxborderw=${boxPadding}`;
    }

    if (item.fontFile) {
      filter += `:fontfile='${escapeFFmpegStr(item.fontFile)}'`;
    }

    if (item.startTime !== undefined || item.duration !== undefined) {
      const start = item.startTime ?? 0;
      const end = item.duration !== undefined ? start + item.duration : duration;
      filter += `:enable='between(t\\,${start}\\,${end})'`;
    }

    textDrawFilters.push(filter);
  }

  if (textDrawFilters.length > 0) {
    const inPad = lastVideoPad.startsWith("[") ? lastVideoPad : `[${lastVideoPad}]`;
    const outPad = "[v_text_final]";
    filterComplex.push(`${inPad}${textDrawFilters.join(",")}${outPad}`);
    lastVideoPad = outPad;
  }

  // 4. Process Audio Tracks
  const audioTracks: AudioTrack[] = norm.audio;
  const audioInputIndices: number[] = [];

  for (const track of audioTracks) {
    if (track.loop) {
      inputs.push("-stream_loop", "-1");
    }
    inputs.push("-i", track.src);
    audioInputIndices.push(inputIndex++);
  }

  const audioFilterPads: string[] = [];
  for (let i = 0; i < audioTracks.length; i++) {
    const track = audioTracks[i];
    const aIdx = audioInputIndices[i];
    const outPad = `[a_track_${i}]`;
    const afs: string[] = [];

    if (track.offset || track.duration) {
      const trimStart = track.offset ?? 0;
      const trimEnd = track.duration !== undefined ? trimStart + track.duration : duration;
      afs.push(`atrim=${trimStart}:${trimEnd}`, `asetpts=PTS-STARTPTS`);
    }

    if (track.volume !== undefined && track.volume !== 1.0) {
      afs.push(`volume=${track.volume}`);
    }

    if (track.fadeIn) {
      afs.push(`afade=t=in:ss=0:d=${track.fadeIn}`);
    }

    if (track.fadeOut) {
      const clipLen = track.duration ?? duration;
      const fadeStart = Math.max(0, clipLen - track.fadeOut);
      afs.push(`afade=t=out:st=${fadeStart}:d=${track.fadeOut}`);
    }

    if (track.startTime) {
      const delayMs = Math.round(track.startTime * 1000);
      afs.push(`adelay=${delayMs}|${delayMs}`);
    }

    if (afs.length > 0) {
      filterComplex.push(`[${aIdx}:a]${afs.join(",")}${outPad}`);
      audioFilterPads.push(outPad);
    } else {
      audioFilterPads.push(`[${aIdx}:a]`);
    }
  }

  let finalAudioMap: string | undefined;
  if (audioFilterPads.length > 0) {
    if (audioFilterPads.length === 1) {
      finalAudioMap = audioFilterPads[0];
    } else {
      const amixInput = audioFilterPads.join("");
      filterComplex.push(`${amixInput}amix=inputs=${audioFilterPads.length}:dropout_transition=0[a_mix_final]`);
      finalAudioMap = "[a_mix_final]";
    }
  }

  // Build Final FFmpeg Arguments
  const args: string[] = ["-y", ...inputs];

  let filtergraphStr: string | undefined;
  if (filterComplex.length > 0) {
    filtergraphStr = filterComplex.join(";");
    args.push("-filter_complex", filtergraphStr);
    args.push("-map", lastVideoPad);

    if (finalAudioMap) {
      args.push("-map", finalAudioMap);
      args.push("-c:a", "aac", "-b:a", "192k");
    }
  } else {
    args.push("-map", "0:v");
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

  return { args, filtergraph: filtergraphStr };
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
