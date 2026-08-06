import type { BackgroundConfig } from "../types/index.js";
import { normalizeColor } from "./position.js";

export interface BackgroundInputOptions {
  stageAsset: (src: string) => string;
  addFFmpegInput: (inputs: string[], src: string, opts?: { loop?: boolean; streamLoop?: boolean; seek?: number }) => void;
}

export function buildSceneBackground(
  inputs: string[],
  filterComplex: string[],
  bg: BackgroundConfig,
  width: number,
  height: number,
  fps: number,
  sceneDur: number,
  bgPad: string,
  currInputIdx: number,
  opts: BackgroundInputOptions
): void {
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
    opts.addFFmpegInput(inputs, opts.stageAsset(bg.src), { loop: true });
    filterComplex.push(
      `[${currInputIdx}:v]scale=${width}:${height},setsar=1,format=yuv420p,trim=duration=${sceneDur},fps=${fps},settb=AVTB,setpts=PTS-STARTPTS${bgPad}`
    );
  } else if (bg.type === "video") {
    opts.addFFmpegInput(inputs, opts.stageAsset(bg.src), { streamLoop: bg.loop });
    filterComplex.push(
      `[${currInputIdx}:v]scale=${width}:${height},setsar=1,format=yuv420p,trim=duration=${sceneDur},fps=${fps},settb=AVTB,setpts=PTS-STARTPTS${bgPad}`
    );
  }
}
