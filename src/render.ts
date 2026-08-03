import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { normalizeComposition } from "./normalize.js";
import { mapTransitionType } from "./transitions.js";
import { animationValueExpression, buildAnimationExpressions } from "./animation.js";
import { prestageRemoteAssets, KINO_VERSION } from "./remote.js";
import {
  getFFmpegBinaryPath,
  assertDrawtextSupport,
  detectBestEncoder,
  detectBestEncoderSync,
} from "./encoder.js";
import type {
  KinoComposition,
  RenderOptions,
  CompileResult,
  TextElement,
  ImageElement,
  VideoElement,
  AudioTrack,
  VideoEncoder,
  NormalizedComposition,
} from "./types.js";

const DEFAULT_FONT_PATH = resolve(
  typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url)),
  "..",
  "assets/inter-regular.ttf"
);

interface KinoManifest {
  ffmpegArgs: string[];
  output: string;
  kinoVersion: string;
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

function buildMediaScaleFilter(elem: ImageElement | VideoElement): string {
  const w = elem.width ?? -1;
  const h = elem.height ?? -1;
  const fit = elem.fit;

  if (w > 0 && h > 0) {
    if (fit === "cover") {
      return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
    }
    if (fit === "contain") {
      return `scale=${w}:${h}:force_original_aspect_ratio=decrease,format=rgba,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`;
    }
  }
  return `scale=${w}:${h}`;
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

function formatBasePosition(val: number | string | undefined, offset: number | undefined, defaultExpr: string): string {
  const base = formatPosition(val, defaultExpr);
  if (offset === undefined || offset === 0) {
    return base;
  }
  return `(${base})+(${offset})`;
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

function formatTextBasePosition(
  val: number | string | undefined,
  offset: number | undefined,
  defaultExpr: string
): string {
  const base = formatTextPosition(val, defaultExpr);
  if (offset === undefined || offset === 0) {
    return base;
  }
  return `(${base})+(${offset})`;
}

function escapeExpr(expr: string): string {
  return expr.replace(/,/g, "\\,");
}

interface MediaLayerLike {
  x?: number | string;
  y?: number | string;
  offsetX?: number;
  offsetY?: number;
  startAt?: number;
  startTime?: number;
  duration?: number;
}

interface MediaAnimation {
  opacity?: string;
  tx?: string;
  ty?: string;
  scale?: string;
}

function applyMediaOverlay(
  filterComplex: string[],
  elemIdx: number,
  startPad: string,
  elem: MediaLayerLike,
  ax: MediaAnimation,
  hasAnimation: boolean,
  duration: number,
  lastVideoPad: string
): string {
  const outPad = `[v_layer_${elemIdx}]`;
  const inPad = lastVideoPad.startsWith("[") ? lastVideoPad : `[${lastVideoPad}]`;
  const startVal = elem.startAt ?? 0;

  if (hasAnimation) {
    let transPad = startPad;

    if (ax.scale) {
      const scaleExpr = `max(0.01,(${ax.scale}))`;
      const np = `[img_scaled_${elemIdx}]`;
      filterComplex.push(`${transPad}scale=w='max(2,iw*${scaleExpr})':h=-2:eval=frame${np}`);
      transPad = np;
    }

    if (ax.opacity) {
      const np = `[img_alpha_${elemIdx}]`;
      const oExpr = ax.opacity.replace(/\bt\b/g, "T").replace(/,/g, "\\,");
      filterComplex.push(
        `${transPad}format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*(${oExpr})'${np}`
      );
      transPad = np;
    }

    const staticX = formatBasePosition(elem.x, elem.offsetX, "(main_w-overlay_w)/2");
    const staticY = formatBasePosition(elem.y, elem.offsetY, "(main_h-overlay_h)/2");

    let ox = staticX;
    let oy = staticY;
    if (ax.tx) ox = `(${staticX}) + (${ax.tx})`;
    if (ax.ty) oy = `(${staticY}) + (${ax.ty})`;
    if (ax.scale) {
      const scaleExpr = `max(0.01,(${ax.scale}))`;
      ox += ` - (overlay_w*(1-(1/${scaleExpr})))/2`;
      oy += ` - (overlay_h*(1-(1/${scaleExpr})))/2`;
    }

    let overlayFilter = `overlay=x='${escapeExpr(ox)}':y='${escapeExpr(oy)}':eval=frame`;
    const hasTiming = elem.startAt !== undefined || elem.duration !== undefined;
    if (hasTiming) {
      const s = startVal;
      const e = elem.duration !== undefined ? s + elem.duration : duration;
      overlayFilter += `:enable='between(t\\,${s}\\,${e})'`;
    }
    filterComplex.push(`${inPad}${transPad}${overlayFilter}${outPad}`);
    return outPad;
  } else {
    const xExpr = formatBasePosition(elem.x, elem.offsetX, "(main_w-overlay_w)/2");
    const yExpr = formatBasePosition(elem.y, elem.offsetY, "(main_h-overlay_h)/2");
    let overlayFilter = `overlay=x=${xExpr}:y=${yExpr}`;
    const hasTiming = elem.startAt !== undefined || elem.duration !== undefined;
    if (hasTiming) {
      const s = startVal;
      const e = elem.duration !== undefined ? s + elem.duration : duration;
      overlayFilter += `:enable='between(t\\,${s}\\,${e})'`;
    }
    filterComplex.push(`${inPad}${startPad}${overlayFilter}${outPad}`);
    return outPad;
  }
}

function addFFmpegInput(
  inputs: string[],
  src: string,
  options: { loop?: boolean; streamLoop?: boolean; seek?: number } = {}
) {
  if (options.streamLoop) {
    inputs.push("-stream_loop", "-1");
  }
  if (options.seek !== undefined && options.seek > 0) {
    inputs.push("-ss", String(options.seek));
  }
  if (options.loop) {
    inputs.push("-loop", "1");
  }
  if (src.startsWith("http://") || src.startsWith("https://")) {
    inputs.push(
      "-user_agent",
      `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Kino/${KINO_VERSION}`
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

  const remoteAssets = prestageRemoteAssets(stagingDir, norm);

  let defaultFontRef: string | undefined;
  if (existsSync(DEFAULT_FONT_PATH)) {
    defaultFontRef = "inter-regular.ttf";
    copyFileSync(DEFAULT_FONT_PATH, join(stagingDir, defaultFontRef));
  }

  const stageAsset = (src: string): string => {
    if (src.startsWith("http://") || src.startsWith("https://")) {
      const staged = remoteAssets.get(src);
      if (staged) return staged;
      throw new Error(`Remote asset was not staged at compile time: ${src}`);
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

    // 2. Fully Composite Each Scene (Background + Elements)
    const useTextFiles = !options?.unsafeInlineText;
    const videoElemAudioPads: string[] = [];
    const sceneCompPads: string[] = [];

    let globalElemIdx = 0;
    for (let sIdx = 0; sIdx < norm.scenes.length; sIdx++) {
      const scene = norm.scenes[sIdx];
      const sceneDur = scene.duration;
      let lastScenePad = sceneBgPads[sIdx];

      // Sort elements inside scene by zIndex (stable sort)
      const sceneElems = (scene.elements || [])
        .map((elem, index) => ({ elem, index }))
        .sort((a, b) => {
          const za = a.elem.zIndex === undefined ? a.index : Math.max(0, a.elem.zIndex);
          const zb = b.elem.zIndex === undefined ? b.index : Math.max(0, b.elem.zIndex);
          return za - zb;
        })
        .map(({ elem }) => elem);

      for (const elem of sceneElems) {
        const elemIdx = ++globalElemIdx;
        const isImage = elem.type === "image";
        const isVideo = elem.type === "video";

        if (isImage || isVideo) {
          const media = elem as ImageElement | VideoElement;
          const currInputIdx = inputIndex++;

          if (isVideo) {
            const vid = elem as VideoElement;
            addFFmpegInput(inputs, stageAsset(vid.src), {
              seek: vid.trimStart,
              streamLoop: vid.loop,
            });
          } else {
            addFFmpegInput(inputs, stageAsset(media.src));
          }

          const scaleFilter = buildMediaScaleFilter(media);
          const ax = buildAnimationExpressions(media, "t");
          const hasAnimation = !!(ax.opacity || ax.tx || ax.ty || ax.scale);

          let startPad: string;
          if (isVideo) {
            const vid = elem as VideoElement;
            const elemStart = vid.startAt ?? 0;
            const elemDur = vid.duration ?? Math.max(0, sceneDur - elemStart);
            const fitPad = `[vid_fit_${elemIdx}]`;
            filterComplex.push(
              `[${currInputIdx}:v]${scaleFilter},trim=duration=${elemDur},setpts=PTS-STARTPTS+${elemStart}/TB,fps=${fps},setsar=1,format=yuv420p${fitPad}`
            );
            startPad = fitPad;

            // Audio track from video source (opt-in via volume > 0) using normalized absolute start time
            if (vid.volume !== undefined && vid.volume > 0) {
              const aPad = `[vid_a_${elemIdx}]`;
              const afs: string[] = [`atrim=duration=${elemDur}`, `asetpts=PTS-STARTPTS`];
              if (vid.volume !== 1.0) {
                afs.push(`volume=${vid.volume}`);
              }
              const aStart = vid.startTime ?? (scene.startTime + elemStart);
              if (aStart > 0) {
                const delayMs = Math.round(aStart * 1000);
                afs.push(`adelay=${delayMs}|${delayMs}`);
              }
              filterComplex.push(`[${currInputIdx}:a]${afs.join(",")}${aPad}`);
              videoElemAudioPads.push(aPad);
            }
          } else {
            const basePad = `[img_base_${elemIdx}]`;
            filterComplex.push(`[${currInputIdx}:v]${scaleFilter}${basePad}`);
            startPad = basePad;
          }

          lastScenePad = applyMediaOverlay(
            filterComplex,
            elemIdx,
            startPad,
            media,
            ax,
            hasAnimation,
            sceneDur,
            lastScenePad
          );
        } else {
          const item = elem as TextElement;
          const content = item.content || "";
          const fontSize = item.fontSize ?? 48;
          const fontColor = item.fontColor ?? "white";

          let textRef: string;
          if (useTextFiles) {
            const name = `text-${elemIdx}.txt`;
            writeFileSync(join(stagingDir, name), content, "utf-8");
            textRef = `textfile='${escapeFFmpegStr(name)}'`;
          } else {
            textRef = `text='${escapeFFmpegStr(content)}'`;
          }

          const ax = buildAnimationExpressions(item, "t");
          const hasAnimProps = !!(ax.opacity || ax.tx || ax.ty || ax.scale);

          const staticX = formatTextBasePosition(item.x, item.offsetX, "(w-text_w)/2");
          const staticY = formatTextBasePosition(item.y, item.offsetY, "(h-text_h)/2");

          let filter: string;
          if (hasAnimProps) {
            let fsExpr = String(fontSize);
            let xExpr = staticX;
            let yExpr = staticY;
            if (ax.scale) {
              const scaleExpr = `max(0.01,(${ax.scale}))`;
              fsExpr = `${fontSize}*(${scaleExpr})`;
              xExpr += ` - (text_w*(1-(1/${scaleExpr})))/2`;
              yExpr += ` - (text_h*(1-(1/${scaleExpr})))/2`;
            }
            if (ax.tx) xExpr = `(${staticX}) + (${ax.tx})`;
            if (ax.ty) yExpr = `(${staticY}) + (${ax.ty})`;

            filter = `drawtext=${textRef}:fontsize='${escapeExpr(fsExpr)}':fontcolor=${fontColor}:x='${escapeExpr(xExpr)}':y='${escapeExpr(yExpr)}'`;
            if (ax.opacity) {
              filter += `:alpha='${escapeExpr(ax.opacity)}'`;
            }
          } else {
            filter = `drawtext=${textRef}:fontsize=${fontSize}:fontcolor=${fontColor}:x=${staticX}:y=${staticY}`;
          }

          if (item.textAlign) {
            filter += `:text_align=${item.textAlign}`;
          }

          if (item.lineHeight !== undefined) {
            const lineSpacing = Math.round(fontSize * (item.lineHeight - 1));
            filter += `:line_spacing=${lineSpacing}`;
          }

          if (item.stroke) {
            const borderColor = normalizeColor(item.stroke.color);
            filter += `:bordercolor=${borderColor}:borderw=${item.stroke.width}`;
          }

          if (item.shadow) {
            const shadowColor = normalizeColor(item.shadow.color);
            const sx = item.shadow.x ?? 2;
            const sy = item.shadow.y ?? 2;
            filter += `:shadowcolor=${shadowColor}:shadowx=${sx}:shadowy=${sy}`;
          }

          if (item.box) {
            const boxColor = item.boxColor || "black@0.5";
            const boxPadding = item.boxPadding ?? 10;
            filter += `:box=1:boxcolor=${boxColor}:boxborderw=${boxPadding}`;
          }

          if (item.fontFile) {
            const fontRef = stageAsset(item.fontFile);
            filter += `:fontfile='${escapeFFmpegStr(fontRef)}'`;
          } else if (defaultFontRef) {
            filter += `:fontfile='${defaultFontRef}'`;
          }

          const startVal = item.startAt ?? 0;
          const endVal = item.duration !== undefined ? startVal + item.duration : sceneDur;
          filter += `:enable='between(t\\,${startVal}\\,${endVal})'`;

          const inPad = lastScenePad.startsWith("[") ? lastScenePad : `[${lastScenePad}]`;
          const textOutPad = `[v_layer_${elemIdx}]`;
          filterComplex.push(`${inPad}${filter}${textOutPad}`);
          lastScenePad = textOutPad;
        }
      }

      sceneCompPads.push(lastScenePad);
    }

    // 3. Scene Transitions Pipeline (xfade)
    let lastVideoPad = "";
    const hasTransitions = norm.scenes.some((s, idx) => idx > 0 && s.transition);

    if (norm.scenes.length === 1) {
      lastVideoPad = sceneCompPads[0];
    } else if (!hasTransitions) {
      const concatInputs = sceneCompPads.map((p) => (p.startsWith("[") ? p : `[${p}]`)).join("");
      const outPad = "[bg_concat]";
      filterComplex.push(`${concatInputs}concat=n=${norm.scenes.length}:v=1:a=0${outPad}`);
      lastVideoPad = outPad;
    } else {
      let currentTransPad = sceneCompPads[0].startsWith("[") ? sceneCompPads[0] : `[${sceneCompPads[0]}]`;
      for (let i = 1; i < norm.scenes.length; i++) {
        const scene = norm.scenes[i];
        const nextScenePad = sceneCompPads[i].startsWith("[") ? sceneCompPads[i] : `[${sceneCompPads[i]}]`;
        const outPad = `[v_trans_${i}]`;
        const offset = scene.startTime;

        if (scene.transition) {
          const xfadeType = mapTransitionType(scene.transition.type);
          const dur = scene.transition.duration;
          filterComplex.push(`${currentTransPad}${nextScenePad}xfade=transition=${xfadeType}:duration=${dur}:offset=${offset}${outPad}`);
        } else {
          const minFrameDur = (1 / fps).toFixed(4);
          filterComplex.push(`${currentTransPad}${nextScenePad}xfade=transition=fade:duration=${minFrameDur}:offset=${offset}${outPad}`);
        }
        currentTransPad = outPad;
      }
      lastVideoPad = currentTransPad;
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

    // Fold video-element audio (opt-in) into the master mix alongside track audio.
    if (videoElemAudioPads.length > 0) {
      audioFilterPads.push(...videoElemAudioPads);
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

    // Encoder Flag Selection: prefer GPU hardware encoding whenever available.
    const encoder =
      options?.encoder && options.encoder !== "auto"
        ? options.encoder
        : detectBestEncoderSync(getFFmpegBinaryPath(options?.ffmpegPath));
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
    if (options.unsafeInlineText) {
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
    const finalOutput = resolve(options.output);
    const args = [...manifest.ffmpegArgs.slice(0, -1), finalOutput];

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
