import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegStatic from "ffmpeg-static";
import type { KinoComposition } from "../types/index.js";

const VENDORED_FFMPEG_BIN = resolveVendoredFFmpeg();

function resolveVendoredFFmpeg(): string | undefined {
  if (process.platform !== "linux" || (process.arch !== "x64" && process.arch !== "arm64")) {
    return undefined;
  }
  const currentDir =
    typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
  const path = join(currentDir, "..", "..", "vendor", "linux", process.arch, "ffmpeg");
  return existsSync(path) ? path : undefined;
}

export function getFFmpegBinaryPath(customPath?: string): string {
  if (customPath) return customPath;
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  if (VENDORED_FFMPEG_BIN) return VENDORED_FFMPEG_BIN;
  if (ffmpegStatic && typeof ffmpegStatic === "string" && existsSync(ffmpegStatic)) {
    return ffmpegStatic;
  }
  if (ffmpegStatic && typeof ffmpegStatic === "string" && !existsSync(ffmpegStatic)) {
    const isPnpm = existsSync(join(process.cwd(), "pnpm-workspace.yaml")) || !!process.env.npm_config_user_agent?.includes("pnpm");
    const installHint = isPnpm
      ? "pnpm approve-builds (then select ffmpeg-static)"
      : "npm rebuild ffmpeg-static (or yarn rebuild ffmpeg-static)";
    throw new Error(
      `[kino] ffmpeg binary not found at ${ffmpegStatic}.\n` +
        `[kino] The ffmpeg-static package was installed but its postinstall script\n` +
        `[kino] did not run, so the binary was never downloaded.\n` +
        `[kino] Fix: run \`${installHint}\`,\n` +
        `[kino] or set the FFMPEG_PATH environment variable to a working ffmpeg binary path.`
    );
  }
  const systemProbe = spawnSync("ffmpeg", ["-version"]);
  if (systemProbe.error || systemProbe.status !== 0) {
    const pmHint = process.env.npm_config_user_agent?.includes("pnpm")
      ? "pnpm approve-builds (then select ffmpeg-static)"
      : process.env.npm_config_user_agent?.includes("yarn")
        ? "yarn rebuild ffmpeg-static"
        : "npm rebuild ffmpeg-static";
    throw new Error(
      `[kino] No ffmpeg binary found in PATH or bundled via ffmpeg-static.\n` +
        `[kino] Install ffmpeg (e.g. apt install ffmpeg / brew install ffmpeg)\n` +
        `[kino] or run \`${pmHint}\` to download the bundled binary,\n` +
        `[kino] or set the FFMPEG_PATH environment variable to a working ffmpeg binary path.`
    );
  }
  return "ffmpeg";
}

export function compositionHasText(composition: KinoComposition): boolean {
  return (composition.scenes ?? []).some((scene) =>
    (scene.elements ?? []).some((element) => element.type === "text")
  );
}

const ffmpegFiltersCache: Record<string, string | null> = {};

function getFFmpegFilters(ffmpegBin: string): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegBin, ["-filters"], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    proc.stdout?.on("data", (chunk) => { output += chunk.toString(); });
    proc.on("error", () => resolve(null));
    proc.on("close", (code) => resolve(code === 0 ? output : null));
  });
}

export async function assertDrawtextSupport(ffmpegBin: string, composition: KinoComposition): Promise<void> {
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

export function getAvailableEncoders(ffmpegBin: string): Promise<string[] | null> {
  if (encoderListCache[ffmpegBin] !== undefined) {
    return Promise.resolve(encoderListCache[ffmpegBin]);
  }
  return new Promise((resolve) => {
    const proc = spawn(ffmpegBin, ["-hide_banner", "-encoders"], { stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    proc.stdout?.on("data", (chunk) => { output += chunk.toString(); });
    proc.on("error", () => { encoderListCache[ffmpegBin] = null; resolve(null); });
    proc.on("close", (code) => {
      if (code !== 0) { encoderListCache[ffmpegBin] = null; resolve(null); return; }
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

export function probeGpuEncoder(ffmpegBin: string, encoder: string): Promise<boolean> {
  const key = `${ffmpegBin}:${encoder}`;
  if (encoderProbeCache[key] !== undefined) return Promise.resolve(encoderProbeCache[key]);
  return new Promise((resolve) => {
    const proc = spawn(ffmpegBin, [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "color=c=black:s=320x240:r=30:d=1",
      "-frames:v", "1", "-pix_fmt", "yuv420p", "-c:v", encoder, "-f", "null", "-",
    ], { stdio: ["ignore", "ignore", "pipe"] });
    proc.stderr?.on("data", () => {});
    proc.on("error", () => { encoderProbeCache[key] = false; resolve(false); });
    proc.on("close", (code) => { encoderProbeCache[key] = code === 0; resolve(code === 0); });
  });
}

const GPU_PRIORITY: Record<string, string[]> = {
  darwin: ["h264_videotoolbox"],
  win32: ["h264_nvenc", "h264_qsv", "h264_amf"],
  linux: ["h264_nvenc", "h264_qsv", "h264_vaapi"],
};

export async function detectBestEncoder(ffmpegBin: string): Promise<string> {
  const available = await getAvailableEncoders(ffmpegBin);
  const candidates = GPU_PRIORITY[process.platform] ?? [];
  for (const enc of candidates) {
    if (available && !available.includes(enc)) continue;
    if (await probeGpuEncoder(ffmpegBin, enc)) return enc;
  }
  return "libx264";
}

export function getAvailableEncodersSync(ffmpegBin: string): string[] | null {
  if (encoderListCache[ffmpegBin] !== undefined) return encoderListCache[ffmpegBin];
  const res = spawnSync(ffmpegBin, ["-hide_banner", "-encoders"], {
    encoding: "utf-8", timeout: 30000, stdio: ["ignore", "pipe", "ignore"],
  });
  if (res.error || res.status !== 0) { encoderListCache[ffmpegBin] = null; return null; }
  const encoders = new Set<string>();
  for (const line of res.stdout.split("\n")) {
    const match = line.match(/^\s*\S{6}\s+([a-zA-Z0-9_]+)\b/);
    if (match && !["Video", "Audio", "Subtitle", "Codecs"].includes(match[1])) {
      encoders.add(match[1]);
    }
  }
  encoderListCache[ffmpegBin] = [...encoders];
  return encoderListCache[ffmpegBin];
}

export function probeGpuEncoderSync(ffmpegBin: string, encoder: string): boolean {
  const key = `${ffmpegBin}:${encoder}`;
  if (encoderProbeCache[key] !== undefined) return encoderProbeCache[key];
  const res = spawnSync(ffmpegBin, [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=black:s=320x240:r=30:d=1",
    "-frames:v", "1", "-pix_fmt", "yuv420p", "-c:v", encoder, "-f", "null", "-",
  ], { timeout: 30000, stdio: ["ignore", "ignore", "pipe"] });
  const ok = res.status === 0 && !res.error;
  encoderProbeCache[key] = ok;
  return ok;
}

export function detectBestEncoderSync(ffmpegBin: string): string {
  const available = getAvailableEncodersSync(ffmpegBin);
  const candidates = GPU_PRIORITY[process.platform] ?? [];
  for (const enc of candidates) {
    if (available && !available.includes(enc)) continue;
    if (probeGpuEncoderSync(ffmpegBin, enc)) return enc;
  }
  return "libx264";
}
