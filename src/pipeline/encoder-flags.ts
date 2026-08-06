import type { VideoEncoder, RenderOptions } from "../types/index.js";
import { detectBestEncoderSync, getFFmpegBinaryPath } from "../encoder/index.js";

const libx264Presets = new Set([
  "ultrafast", "superfast", "veryfast", "faster", "fast",
  "medium", "slow", "slower", "veryslow", "placebo",
]);
const nvencPresets = new Set([
  "default", "slow", "medium", "fast", "hp", "hq", "bd", "ll",
  "llhq", "llhp", "lossless", "losslesshp", "p1", "p2", "p3", "p4", "p5", "p6", "p7",
]);
const amfQualities = new Set(["speed", "balanced", "quality"]);

export function resolveEncoderSync(options?: Partial<RenderOptions>): VideoEncoder {
  if (options?.encoder && options.encoder !== "auto") {
    return options.encoder;
  }
  return detectBestEncoderSync(getFFmpegBinaryPath(options?.ffmpegPath)) as VideoEncoder;
}

export function buildEncoderFlags(encoder: VideoEncoder, preset?: string): string[] {
  if (encoder === "h264_nvenc" || encoder === "hevc_nvenc") {
    const p = preset && nvencPresets.has(preset) ? preset : "p2";
    return ["-c:v", encoder, "-preset", p, "-rc:v", "vbr", "-pix_fmt", "yuv420p"];
  }
  if (encoder === "h264_qsv") {
    const p = preset && !libx264Presets.has(preset) ? preset : "veryfast";
    return ["-c:v", "h264_qsv", "-preset", p, "-pix_fmt", "nv12"];
  }
  if (encoder === "h264_amf") {
    const q = preset && amfQualities.has(preset) ? preset : "speed";
    return ["-c:v", "h264_amf", "-quality", q, "-pix_fmt", "yuv420p"];
  }
  if (encoder === "h264_videotoolbox") {
    return ["-c:v", "h264_videotoolbox", "-pix_fmt", "yuv420p"];
  }
  // libx264 (default)
  const p = preset && libx264Presets.has(preset) ? preset : "veryfast";
  return ["-c:v", "libx264", "-preset", p, "-pix_fmt", "yuv420p"];
}
