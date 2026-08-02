import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import ffmpegStatic from "ffmpeg-static";
import { normalizeComposition } from "./normalize.js";
import type {
  KinoComposition,
  RenderOptions,
  CompileResult,
  TextElement,
  ImageElement,
  AudioTrack,
  VideoEncoder,
} from "./types.js";

const VENDORED_FFMPEG_BIN = resolveVendoredFFmpeg();
const KINO_VERSION = "0.3.0";

interface KinoManifest {
  ffmpegArgs: string[];
  output: string;
  kinoVersion: string;
}

function resolveVendoredFFmpeg(): string | undefined {
  if (process.platform !== "linux" || (process.arch !== "x64" && process.arch !== "arm64")) {
    return undefined;
  }
  const currentDir =
    typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
  const path = join(currentDir, "..", "vendor", "linux", process.arch, "ffmpeg");
  return existsSync(path) ? path : undefined;
}

function getFFmpegBinaryPath(customPath?: string): string {
  if (customPath) return customPath;
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  if (VENDORED_FFMPEG_BIN) return VENDORED_FFMPEG_BIN;
  if (ffmpegStatic && typeof ffmpegStatic === "string" && existsSync(ffmpegStatic)) {
    return ffmpegStatic;
  }
  return "ffmpeg";
}

function compositionHasText(composition: KinoComposition): boolean {
  return (composition.scenes ?? []).some((scene) =>
    (scene.elements ?? []).some((element) => element.type !== "image")
  );
}

const ffmpegFiltersCache: Record<string, string | null> = {};

function getFFmpegFilters(ffmpegBin: string): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegBin, ["-filters"], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    proc.stdout?.on("data", (chunk) => {
      output += chunk.toString();
    });
    proc.on("error", () => resolve(null));
    proc.on("close", (code) => resolve(code === 0 ? output : null));
  });
}

async function assertDrawtextSupport(ffmpegBin: string, composition: KinoComposition): Promise<void> {
  if (!compositionHasText(composition)) return;
  if (ffmpegFiltersCache[ffmpegBin] === undefined) {
    ffmpegFiltersCache[ffmpegBin] = await getFFmpegFilters(ffmpegBin);
  }
  const filters = ffmpegFiltersCache[ffmpegBin];
  if (filters !== null && !filters.includes("drawtext")) {
    throw new Error(
      `ffmpeg binary at ${ffmpegBin} has no drawtext support (missing libharfbuzz). ` +
        `Pass --ffmpeg-path to a build with drawtext, or fix the bundled Linux binary.`
    );
  }
}

const encoderListCache: Record<string, string[] | null> = {};
const encoderProbeCache: Record<string, boolean> = {};

function getAvailableEncoders(ffmpegBin: string): Promise<string[] | null> {
  if (encoderListCache[ffmpegBin] !== undefined) {
    return Promise.resolve(encoderListCache[ffmpegBin]);
  }
  return new Promise((resolve) => {
    const proc = spawn(ffmpegBin, ["-hide_banner", "-encoders"], { stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    proc.stdout?.on("data", (chunk) => {
      output += chunk.toString();
    });
    proc.on("error", () => {
      encoderListCache[ffmpegBin] = null;
      resolve(null);
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        encoderListCache[ffmpegBin] = null;
        resolve(null);
        return;
      }
      const encoders = new Set<string>();
      for (const line of output.split("\n")) {
        const match = line.match(/^\s*\S{6}\s+([a-zA-Z0-9_]+)\b/);
        if (match && !["Video", "Audio", "Subtitle", "Codecs"].includes(match[1])) {
          encoders.add(match[1]);
        }
      }
      encoderListCache[ffmpegBin] = [...encoders];
      resolve(encoderListCache[ffmpegBin]);
    });
  });
}

function probeGpuEncoder(ffmpegBin: string, encoder: string): Promise<boolean> {
  const key = `${ffmpegBin}:${encoder}`;
  if (encoderProbeCache[key] !== undefined) {
    return Promise.resolve(encoderProbeCache[key]);
  }
  return new Promise((resolve) => {
    const proc = spawn(
      ffmpegBin,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=320x240:r=30:d=1",
        "-frames:v",
        "1",
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        encoder,
        "-f",
        "null",
        "-",
      ],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
    proc.stderr?.on("data", () => {});
    proc.on("error", () => {
      encoderProbeCache[key] = false;
      resolve(false);
    });
    proc.on("close", (code) => {
      encoderProbeCache[key] = code === 0;
      resolve(code === 0);
    });
  });
}

const GPU_PRIORITY: Record<string, string[]> = {
  darwin: ["h264_videotoolbox"],
  win32: ["h264_nvenc", "h264_qsv", "h264_amf"],
  linux: ["h264_nvenc", "h264_qsv", "h264_vaapi"],
};

async function detectBestEncoder(ffmpegBin: string): Promise<string> {
  const available = await getAvailableEncoders(ffmpegBin);
  const candidates = GPU_PRIORITY[process.platform] ?? [];
  for (const enc of candidates) {
    if (available && !available.includes(enc)) continue;
    if (await probeGpuEncoder(ffmpegBin, enc)) return enc;
  }
  return "libx264";
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
    .replace(/'/g, "'\\''")
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

  const stagingDir = mkdtempSync(join(tmpdir(), "kino-stage-"));
  const assetNames = new Map<string, string>();
  let assetCounter = 0;

  const stageAsset = (src: string): string => {
    if (src.startsWith("http://") || src.startsWith("https://")) {
      return src;
    }
    const existing = assetNames.get(src);
    if (existing) return existing;
    if (!existsSync(src)) return src;
    const name = `asset-${++assetCounter}${extname(src) || ".bin"}`;
    copyFileSync(src, join(stagingDir, name));
    assetNames.set(src, name);
    return name;
  };

  const inputs: string[] = [];
  const filterComplex: string[] = [];

  let inputIndex = 0;

  try {
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
        addFFmpegInput(inputs, stageAsset(bg.src), { loop: true });
        filterComplex.push(
          `[${currInputIdx}:v]scale=${width}:${height},setsar=1,format=yuv420p,trim=duration=${sceneDur},fps=${fps},settb=AVTB,setpts=PTS-STARTPTS${bgPad}`
        );
      } else if (bg.type === "video") {
        addFFmpegInput(inputs, stageAsset(bg.src), { streamLoop: bg.loop });
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
      addFFmpegInput(inputs, stageAsset(img.src));
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
    const useTextFiles = !options?.unsafeInlineText;
    const textDrawFilters: string[] = [];
    for (const [textIdx, item] of textElements.entries()) {
      const text = item.content || "";
      const fontSize = item.fontSize ?? 48;
      const fontColor = item.fontColor ?? "white";
      const xExpr = formatTextPosition(item.x, "(w-text_w)/2");
      const yExpr = formatTextPosition(item.y, "(h-text_h)/2");

      let textRef: string;
      if (useTextFiles) {
        const name = `text-${textIdx + 1}.txt`;
        writeFileSync(join(stagingDir, name), text, "utf-8");
        textRef = `textfile='${escapeFFmpegStr(name)}'`;
      } else {
        textRef = `text='${escapeFFmpegStr(text)}'`;
      }

      let filter = `drawtext=${textRef}:fontsize=${fontSize}:fontcolor=${fontColor}:x=${xExpr}:y=${yExpr}`;

      if (item.box) {
        const boxColor = item.boxColor || "black@0.5";
        const boxPadding = item.boxPadding ?? 10;
        filter += `:box=1:boxcolor=${boxColor}:boxborderw=${boxPadding}`;
      }

      if (item.fontFile) {
        const fontRef = stageAsset(item.fontFile);
        filter += `:fontfile='${escapeFFmpegStr(fontRef)}'`;
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
      addFFmpegInput(inputs, stageAsset(track.src), { streamLoop: track.loop });
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

    const libx264Presets = new Set([
      "ultrafast", "superfast", "veryfast", "faster", "fast",
      "medium", "slow", "slower", "veryslow", "placebo",
    ]);
    const nvencPresets = new Set([
      "default", "slow", "medium", "fast", "hp", "hq", "bd", "ll",
      "llhq", "llhp", "lossless", "losslesshp", "p1", "p2", "p3", "p4", "p5", "p6", "p7",
    ]);
    const amfQualities = new Set(["speed", "balanced", "quality"]);

    if (encoder === "h264_nvenc" || encoder === "hevc_nvenc") {
      const preset = options?.preset && nvencPresets.has(options.preset) ? options.preset : "p2";
      encoderFlags.push("-c:v", encoder, "-preset", preset, "-rc:v", "vbr", "-pix_fmt", "yuv420p");
    } else if (encoder === "h264_qsv") {
      const preset = options?.preset && !libx264Presets.has(options.preset) ? options.preset : "veryfast";
      encoderFlags.push("-c:v", "h264_qsv", "-preset", preset, "-pix_fmt", "nv12");
    } else if (encoder === "h264_amf") {
      const quality = options?.preset && amfQualities.has(options.preset) ? options.preset : "speed";
      encoderFlags.push("-c:v", "h264_amf", "-quality", quality, "-pix_fmt", "yuv420p");
    } else if (encoder === "h264_videotoolbox") {
      encoderFlags.push("-c:v", "h264_videotoolbox", "-pix_fmt", "yuv420p");
    } else {
      const preset = options?.preset && libx264Presets.has(options.preset) ? options.preset : "veryfast";
      encoderFlags.push("-c:v", "libx264", "-preset", preset, "-pix_fmt", "yuv420p");
    }

    args.push("-t", String(duration), ...encoderFlags, output);

    // The portable args stored in the artifact use a relative output placeholder;
    // the caller (render) substitutes the real destination when spawning.
    const portableArgs = [...args.slice(0, -1), basename(output)];

    const manifest: KinoManifest = {
      ffmpegArgs: portableArgs,
      output: basename(output),
      kinoVersion: KINO_VERSION,
    };
    writeFileSync(join(stagingDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

    const kinoPath =
      options?.kinoPath ?? join(dirname(output), `${basename(output, extname(output))}.kino`);
    mkdirSync(dirname(kinoPath), { recursive: true });

    const zip = new AdmZip();
    for (const file of readdirSync(stagingDir, { withFileTypes: true })) {
      if (file.isFile()) {
        zip.addFile(file.name, readFileSync(join(stagingDir, file.name)));
      }
    }
    zip.writeZip(kinoPath);

    return { kinoFilePath: kinoPath, args: portableArgs, filtergraph: filtergraphStr };
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

function extractKino(kinoPath: string, destDir: string): void {
  const zip = new AdmZip(kinoPath);
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const target = resolve(destDir, entry.entryName);
    if (target !== destDir && !target.startsWith(destDir + sep)) {
      throw new Error(`Refusing to extract unsafe .kino entry: ${entry.entryName}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, entry.getData());
  }
}

function readKinoManifest(kinoPath: string): KinoManifest {
  const zip = new AdmZip(kinoPath);
  const entry = zip.getEntry("manifest.json");
  if (!entry) {
    throw new Error(`Invalid .kino file (missing manifest.json): ${kinoPath}`);
  }
  return JSON.parse(entry.getData().toString("utf8")) as KinoManifest;
}

function spawnFFmpegProcess(
  ffmpegBin: string,
  args: string[],
  verbose?: boolean,
  cwd?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const process = spawn(ffmpegBin, args, { stdio: verbose ? "inherit" : "pipe", cwd });

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
  compositionOrKinoPath: KinoComposition | string,
  options: RenderOptions
): Promise<{ output: string }> {
  const ffmpegBin = getFFmpegBinaryPath(options.ffmpegPath);

  let requestedEncoder: VideoEncoder | undefined = options.encoder;
  if (requestedEncoder === "auto" || requestedEncoder === undefined) {
    requestedEncoder = (await detectBestEncoder(ffmpegBin)) as VideoEncoder;
    if (requestedEncoder !== "libx264") {
      console.log(`[kino] auto: using hardware encoder '${requestedEncoder}'`);
    }
  }
  const renderOptions = { ...options, encoder: requestedEncoder };

  let kinoPath: string;
  let ownsKinoFile = false;

  if (typeof compositionOrKinoPath === "string") {
    kinoPath = compositionOrKinoPath;
    if (!existsSync(kinoPath)) {
      throw new Error(`.kino file not found: ${kinoPath}`);
    }
  } else {
    const composition = compositionOrKinoPath;
    await assertDrawtextSupport(ffmpegBin, composition);
    if (compositionHasText(composition) && options.unsafeInlineText) {
      console.warn(
        "[kino] Warning: unsafeInlineText disables textfile delivery; text with apostrophes may render blank on some platforms."
      );
    }
    const kinoDir = mkdtempSync(join(tmpdir(), "kino-"));
    kinoPath = join(kinoDir, "composition.kino");
    ownsKinoFile = true;
    try {
      compile(composition, { ...renderOptions, kinoPath });
    } catch (err) {
      rmSync(kinoDir, { recursive: true, force: true });
      throw err;
    }
  }

  const extractionDir = mkdtempSync(join(tmpdir(), "kino-extract-"));
  try {
    extractKino(kinoPath, extractionDir);
    const manifest = readKinoManifest(kinoPath);
    const args = [...manifest.ffmpegArgs.slice(0, -1), options.output];

    const spawnWith = (spawnArgs: string[]) => {
      if (options.verbose) {
        console.log(`[kino] Spawning: ${ffmpegBin} ${spawnArgs.join(" ")}`);
      }
      return spawnFFmpegProcess(ffmpegBin, spawnArgs, options.verbose, extractionDir);
    };

    try {
      await spawnWith(args);
      return { output: options.output };
    } catch (err: any) {
      const reqEncoder = renderOptions.encoder;
      if (reqEncoder && reqEncoder !== "libx264") {
        console.warn(
          `[kino] GPU encoder '${reqEncoder}' failed or unavailable on host system. Automatically falling back to universal CPU encoder 'libx264'...`
        );
        if (typeof compositionOrKinoPath === "string") {
          throw err;
        }
        const fbKinoDir = mkdtempSync(join(tmpdir(), "kino-"));
        try {
          const fbKinoPath = join(fbKinoDir, "composition.kino");
          compile(compositionOrKinoPath, { ...options, encoder: "libx264", kinoPath: fbKinoPath });
          const fbManifest = readKinoManifest(fbKinoPath);
          const fbArgs = [...fbManifest.ffmpegArgs.slice(0, -1), options.output];
          if (options.verbose) {
            console.log(`[kino] Fallback spawning: ${ffmpegBin} ${fbArgs.join(" ")}`);
          }
          await spawnFFmpegProcess(ffmpegBin, fbArgs, options.verbose, extractionDir);
          return { output: options.output };
        } finally {
          rmSync(fbKinoDir, { recursive: true, force: true });
        }
      }
      throw err;
    }
  } finally {
    try {
      rmSync(extractionDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
    if (ownsKinoFile) {
      try {
        rmSync(dirname(kinoPath), { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }
}
