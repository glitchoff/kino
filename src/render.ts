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

function formatTextPosition(val: number | string | undefined, defaultExpr: string): string {
  if (val === undefined || val === "center") {
    return defaultExpr;
  }
  if (typeof val === "number") {
    return String(val);
  }

  const bottom = val.match(/^bottom-(\d+(?:\.\d+)?)$/);
  if (bottom) {
    return `h-text_h-${bottom[1]}`;
  }

  const top = val.match(/^top-(\d+(?:\.\d+)?)$/);
  if (top) {
    return top[1];
  }

  return val;
}

function addFFmpegInput(
  inputs: string[],
  src: string,
  options: { loop?: boolean; streamLoop?: boolean } = {}
) {
  if (options.streamLoop) {
    inputs.push("-stream_loop", "-1");
  }
  if (options.loop) {
    inputs.push("-loop", "1");
  }
  if (src.startsWith("http://") || src.startsWith("https://")) {
    inputs.push(
      "-user_agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Kino/0.2.0"
    );
  }
  inputs.push("-i", src);
}

export function compile(composition: KinoComposition, options?: Partial<RenderOptions>): CompileResult {
  const norm = normalizeComposition(composition);
  const { width, height, duration, fps } = norm;
  const output = options?.output || "./out.mp4";

  const inputs: string[] = [];
  const filterComplex: string[] = [];

  let inputIndex = 0;

  // 1. Process Per-Scene Background Inputs
  const sceneBgPads: string[] = [];

  for (let i = 0; i < norm.scenes.length; i++) {
    const scene = norm.scenes[i];
    const sceneDur = scene.duration;
    const bg = scene.background;
    const bgPad = `[bg_scene_${i}]`;
    const currInputIdx = inputIndex++;

    if (bg.type === "color") {
      const bgHex = normalizeColor(bg.value);
      const colorSource = `color=c=${bgHex}:s=${width}x${height}:r=${fps}:d=${sceneDur}`;
      inputs.push("-f", "lavfi", "-i", colorSource);
      filterComplex.push(`[${currInputIdx}:v]fps=${fps},setsar=1,format=yuv420p,settb=AVTB${bgPad}`);
    } else if (bg.type === "gradient") {
      const from = normalizeColor(bg.from);
      const to = normalizeColor(bg.to);
      const gradSource = `gradients=c0=${from}:c1=${to}:s=${width}x${height}:r=${fps}:d=${sceneDur}`;
      inputs.push("-f", "lavfi", "-i", gradSource);
      filterComplex.push(`[${currInputIdx}:v]fps=${fps},setsar=1,format=yuv420p,settb=AVTB${bgPad}`);
    } else if (bg.type === "image") {
      addFFmpegInput(inputs, bg.src, { loop: true });
      filterComplex.push(
        `[${currInputIdx}:v]scale=${width}:${height},setsar=1,format=yuv420p,trim=duration=${sceneDur},fps=${fps},settb=AVTB,setpts=PTS-STARTPTS${bgPad}`
      );
    } else if (bg.type === "video") {
      addFFmpegInput(inputs, bg.src, { streamLoop: bg.loop });
      filterComplex.push(
        `[${currInputIdx}:v]scale=${width}:${height},setsar=1,format=yuv420p,trim=duration=${sceneDur},fps=${fps},settb=AVTB,setpts=PTS-STARTPTS${bgPad}`
      );
    }

    sceneBgPads.push(bgPad);
  }

  let lastVideoPad = "";

  if (norm.scenes.length === 1) {
    lastVideoPad = sceneBgPads[0];
  } else if (norm.timeline === "absolute") {
    const baseColorIdx = inputIndex++;
    const baseSource = `color=c=black:s=${width}x${height}:r=${fps}:d=${duration}`;
    inputs.push("-f", "lavfi", "-i", baseSource);
    let currBasePad = `[${baseColorIdx}:v]`;

    for (let i = 0; i < norm.scenes.length; i++) {
      const scene = norm.scenes[i];
      const outPad = `[bg_abs_${i}]`;
      const start = scene.startTime;
      const end = start + scene.duration;
      filterComplex.push(
        `${currBasePad}${sceneBgPads[i]}overlay=x=0:y=0:enable='between(t\\,${start}\\,${end})'${outPad}`
      );
      currBasePad = outPad;
    }
    lastVideoPad = currBasePad;
  } else {
    // Sequential timeline (default)
    const concatInputs = sceneBgPads.join("");
    const outPad = "[bg_concat]";
    filterComplex.push(`${concatInputs}concat=n=${norm.scenes.length}:v=1:a=0${outPad}`);
    lastVideoPad = outPad;
  }

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
    addFFmpegInput(inputs, img.src);
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
    const xExpr = formatTextPosition(item.x, "(w-text_w)/2");
    const yExpr = formatTextPosition(item.y, "(h-text_h)/2");

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
    addFFmpegInput(inputs, track.src, { streamLoop: track.loop });
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

  // Encoder Flag Selection
  const defaultGpuEncoder = process.platform === "darwin" ? "h264_videotoolbox" : "h264_nvenc";
  const encoder = options?.encoder === "auto" ? defaultGpuEncoder : (options?.encoder || "libx264");
  const encoderFlags: string[] = [];

  if (encoder === "h264_nvenc") {
    encoderFlags.push("-c:v", "h264_nvenc", "-preset", options?.preset || "p2", "-rc:v", "vbr", "-pix_fmt", "yuv420p");
  } else if (encoder === "hevc_nvenc") {
    encoderFlags.push("-c:v", "hevc_nvenc", "-preset", options?.preset || "p2", "-rc:v", "vbr", "-pix_fmt", "yuv420p");
  } else if (encoder === "h264_qsv") {
    encoderFlags.push("-c:v", "h264_qsv", "-preset", options?.preset || "veryfast", "-pix_fmt", "nv12");
  } else if (encoder === "h264_amf") {
    encoderFlags.push("-c:v", "h264_amf", "-quality", "speed", "-pix_fmt", "yuv420p");
  } else if (encoder === "h264_videotoolbox") {
    encoderFlags.push("-c:v", "h264_videotoolbox", "-pix_fmt", "yuv420p");
  } else {
    encoderFlags.push("-c:v", "libx264", "-preset", options?.preset || "veryfast", "-pix_fmt", "yuv420p");
  }

  args.push("-t", String(duration), ...encoderFlags, output);

  return { args, filtergraph: filtergraphStr };
}

function spawnFFmpegProcess(
  ffmpegBin: string,
  args: string[],
  verbose?: boolean
): Promise<void> {
  return new Promise((resolve, reject) => {
    const process = spawn(ffmpegBin, args, { stdio: verbose ? "inherit" : "pipe" });

    let stderr = "";
    if (!verbose && process.stderr) {
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
        resolve();
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

export async function render(
  composition: KinoComposition,
  options: RenderOptions
): Promise<{ output: string }> {
  const ffmpegBin = getFFmpegBinaryPath(options.ffmpegPath);
  const { args } = compile(composition, options);

  if (options.verbose) {
    console.log(`[kino] Spawning: ${ffmpegBin} ${args.join(" ")}`);
  }

  try {
    await spawnFFmpegProcess(ffmpegBin, args, options.verbose);
    return { output: options.output };
  } catch (err: any) {
    const reqEncoder = options.encoder;
    if (reqEncoder && reqEncoder !== "libx264") {
      console.warn(
        `[kino] GPU encoder '${reqEncoder}' failed or unavailable on host system. Automatically falling back to universal CPU encoder 'libx264'...`
      );
      const fallbackOptions: RenderOptions = { ...options, encoder: "libx264" };
      const fallbackCompile = compile(composition, fallbackOptions);
      if (options.verbose) {
        console.log(`[kino] Fallback spawning: ${ffmpegBin} ${fallbackCompile.args.join(" ")}`);
      }
      await spawnFFmpegProcess(ffmpegBin, fallbackCompile.args, options.verbose);
      return { output: options.output };
    }
    throw err;
  }
}
