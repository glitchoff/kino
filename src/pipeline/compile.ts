import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeComposition } from "../normalize/index.js";
import { prestageRemoteAssets, KINO_VERSION } from "../remote/index.js";
import { packKino } from "../artifact/index.js";
import { buildAnimationExpressions } from "../animation/index.js";
import { buildSceneBackground } from "./background.js";
import { buildTextFilter } from "./elements/text.js";
import { buildMediaScaleFilter, applyMediaOverlay } from "./elements/media.js";
import { renderHtmlBatchSync } from "./elements/html.js";
import { buildTransitionPipeline } from "./transitions.js";
import { buildAudioMix } from "./audio.js";
import { resolveEncoderSync, buildEncoderFlags } from "./encoder-flags.js";
import type {
  KinoComposition,
  RenderOptions,
  CompileResult,
  ImageElement,
  VideoElement,
  HtmlElement,
} from "../types/index.js";

const DEFAULT_FONT_PATH = resolve(
  typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url)),
  "../../assets/inter-regular.ttf"
);

function addFFmpegInput(
  inputs: string[],
  src: string,
  options: { loop?: boolean; streamLoop?: boolean; seek?: number } = {}
): void {
  if (options.streamLoop) inputs.push("-stream_loop", "-1");
  if (options.seek !== undefined && options.seek > 0) inputs.push("-ss", String(options.seek));
  if (options.loop) inputs.push("-loop", "1");
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

  const htmlElements = norm.elements.filter((elem): elem is HtmlElement => elem.type === "html");
  const htmlPaths = renderHtmlBatchSync(htmlElements, stagingDir, options?.browserPath);
  const htmlPathMap = new Map(htmlElements.map((elem, index) => [elem, htmlPaths[index]]));

  try {
    // ── Stage 1: Per-scene backgrounds ──────────────────────────────────────
    const sceneBgPads: string[] = [];

    for (let i = 0; i < norm.scenes.length; i++) {
      const scene = norm.scenes[i];
      const bgPad = `[bg_scene_${i}]`;
      const currInputIdx = inputIndex++;

      buildSceneBackground(inputs, filterComplex, scene.background, width, height, fps, scene.duration, bgPad, currInputIdx, {
        stageAsset,
        addFFmpegInput,
      });

      sceneBgPads.push(bgPad);
    }

    // ── Stage 2: Composite each scene (background + elements) ────────────────
    const useTextFiles = !options?.unsafeInlineText;
    const videoElemAudioPads: string[] = [];
    const sceneCompPads: string[] = [];
    let globalElemIdx = 0;

    for (let sIdx = 0; sIdx < norm.scenes.length; sIdx++) {
      const scene = norm.scenes[sIdx];
      const sceneDur = scene.duration;
      let lastScenePad = sceneBgPads[sIdx];

      // Sort elements by zIndex (stable)
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
        const isImage = elem.type === "image" || elem.type === "html";
        const isVideo = elem.type === "video";

        if (isImage || isVideo) {
          const media =
            elem.type === "html"
              ? ({ ...elem, type: "image", src: htmlPathMap.get(elem as HtmlElement)! } as ImageElement)
              : (elem as ImageElement | VideoElement);
          const currInputIdx = inputIndex++;

          if (isVideo) {
            const vid = elem as VideoElement;
            addFFmpegInput(inputs, stageAsset(vid.src), { seek: vid.trimStart, streamLoop: vid.loop });
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

            if (vid.volume !== undefined && vid.volume > 0) {
              const aPad = `[vid_a_${elemIdx}]`;
              const afs: string[] = [`atrim=duration=${elemDur}`, `asetpts=PTS-STARTPTS`];
              if (vid.volume !== 1.0) afs.push(`volume=${vid.volume}`);
              const aStart = vid.startTime ?? scene.startTime + elemStart;
              if (aStart > 0) {
                const delayMs = Math.round(aStart * 1000);
                afs.push(`adelay=${delayMs}|${delayMs}`);
              }
              filterComplex.push(`[${currInputIdx}:a]${afs.join(",")}${aPad}`);
              videoElemAudioPads.push(aPad);
            }
          } else {
            const basePad = `[img_base_${elemIdx}]`;
            filterComplex.push(
              `[${currInputIdx}:v]${scaleFilter},fps=${fps},setpts=PTS-STARTPTS,settb=AVTB${basePad}`
            );
            startPad = basePad;
          }

          lastScenePad = applyMediaOverlay(
            filterComplex, elemIdx, startPad, media, ax, hasAnimation, sceneDur, lastScenePad
          );
        } else {
          // Text element
          const item = elem as import("../types/index.js").TextElement;
          const filter = buildTextFilter(item, elemIdx, stagingDir, sceneDur, useTextFiles, defaultFontRef, stageAsset);
          const inPad = lastScenePad.startsWith("[") ? lastScenePad : `[${lastScenePad}]`;
          const textOutPad = `[v_layer_${elemIdx}]`;
          filterComplex.push(`${inPad}${filter}${textOutPad}`);
          lastScenePad = textOutPad;
        }
      }

      sceneCompPads.push(lastScenePad);
    }

    // ── Stage 3: Transitions ─────────────────────────────────────────────────
    const lastVideoPad = buildTransitionPipeline(filterComplex, norm.scenes, sceneCompPads, fps);

    // ── Stage 4: Audio ───────────────────────────────────────────────────────
    const audioTracks = norm.audio;
    const audioInputIndices: number[] = [];
    for (const track of audioTracks) {
      addFFmpegInput(inputs, stageAsset(track.src), { streamLoop: track.loop });
      audioInputIndices.push(inputIndex++);
    }
    const finalAudioMap = buildAudioMix(filterComplex, audioTracks, audioInputIndices, videoElemAudioPads, duration);

    // ── Stage 5: Assemble final FFmpeg args ───────────────────────────────────
    const encoder = resolveEncoderSync(options);
    const encoderFlags = buildEncoderFlags(encoder, options?.preset);

    const args: string[] = ["-y", ...inputs];
    let filtergraphStr: string | undefined;

    if (filterComplex.length > 0) {
      filtergraphStr = filterComplex.join(";");
      args.push("-filter_complex", filtergraphStr);
      args.push("-map", lastVideoPad);
      if (finalAudioMap) {
        args.push("-map", finalAudioMap, "-c:a", "aac", "-b:a", "192k");
      }
    } else {
      args.push("-map", "0:v");
    }

    args.push("-t", String(duration), ...encoderFlags, output);
    const portableArgs = [...args.slice(0, -1), basename(output)];

    // ── Stage 6: Write manifest & pack .kino ─────────────────────────────────
    const manifest = { ffmpegArgs: portableArgs, output: basename(output), kinoVersion: KINO_VERSION };
    writeFileSync(join(stagingDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

    const kinoPath =
      options?.kinoPath ?? join(dirname(output), `${basename(output, extname(output))}.kino`);

    packKino(stagingDir, kinoPath);

    return { kinoFilePath: kinoPath, args: portableArgs, filtergraph: filtergraphStr };
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}
