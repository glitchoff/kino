import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeComposition, selectScene } from "../normalize/index.js";
import { prestageRemoteAssets, KINO_VERSION, defaultAssetCacheDir } from "../remote/index.js";
import { isYtdlpSource, ytdlpUrl, fetchWithYtdlp } from "../remote/ytdlp.js";
import { isTtsSpec, synthesizeToWav, stageTts } from "../tts/piper.js";
import { packKino } from "../artifact/index.js";
import { buildAnimationExpressions } from "../animation/index.js";
import { buildSceneBackground } from "./background.js";
import { buildTextFilter, buildKaraokeFilters, hasCaptionWords } from "./elements/text.js";
import { escapeFFmpegStr } from "./position.js";
import { buildMediaScaleFilter, applyMediaOverlay, buildChromaKeyFilter } from "./elements/media.js";
import type { ChromaKey } from "./elements/media.js";
import { renderHtmlBatchSync } from "./elements/html.js";
import { buildTransitionPipeline } from "./transitions.js";
import { buildAudioMix } from "./audio.js";
import { resolveEncoderSync, buildEncoderFlags } from "./encoder-flags.js";
import { resolvePreviewHeight } from "../types/render.js";
import type {
  KinoComposition,
  RenderOptions,
  CompileResult,
  NormalizedHtmlElement,
  NormalizedImageElement,
  NormalizedVideoElement,
  NormalizedTextElement,
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
  let norm = normalizeComposition(composition);
  if (options?.scene) norm = selectScene(norm, options.scene);
  const { width, height, duration, fps } = norm;
  const output = options?.output || "./out.mp4";

  const stagingDir = mkdtempSync(join(tmpdir(), "kino-stage-"));
  const assetNames = new Map<string, string>();
  let assetCounter = 0;

  const assetCacheDir =
    options?.assetCache === false
      ? undefined
      : options?.assetCacheDir ?? defaultAssetCacheDir();

  const remoteAssets = prestageRemoteAssets(stagingDir, norm, {
    cache: options?.assetCache,
    cacheDir: options?.assetCacheDir,
  });

  let defaultFontRef: string | undefined;
  if (existsSync(DEFAULT_FONT_PATH)) {
    defaultFontRef = "inter-regular.ttf";
    copyFileSync(DEFAULT_FONT_PATH, join(stagingDir, defaultFontRef));
  }

  const stageAsset = (src: string): string => {
    if (isYtdlpSource(src)) {
      if (!options?.ytdlp) {
        throw new Error(
          `'${src}' uses the yt: prefix, but yt-dlp support is off. Enable it with --ytdlp (yt-dlp must be installed).`
        );
      }
      const existingYt = assetNames.get(src);
      if (existingYt) return existingYt;
      const name = fetchWithYtdlp(ytdlpUrl(src), {
        stagingDir,
        cacheDir: options.assetCache === false ? undefined : assetCacheDir,
        cookies: options.ytdlpCookies,
      });
      assetNames.set(src, name);
      return name;
    }
    if (src.startsWith("http://") || src.startsWith("https://")) {
      const staged = remoteAssets.map.get(src);
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

  const htmlElements = norm.elements.filter((elem): elem is NormalizedHtmlElement => elem.type === "html");
  const htmlPaths = renderHtmlBatchSync(htmlElements as any, stagingDir, options?.browserPath);
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
              ? ({ ...elem, type: "image", src: htmlPathMap.get(elem as NormalizedHtmlElement)! } as NormalizedImageElement)
              : (elem as NormalizedImageElement | NormalizedVideoElement);
          const currInputIdx = inputIndex++;

          if (isVideo) {
            const vid = elem as NormalizedVideoElement;
            addFFmpegInput(inputs, stageAsset(vid.src), { seek: vid.trimStart, streamLoop: vid.loop });
          } else {
            addFFmpegInput(inputs, stageAsset(media.src));
          }

          const scaleFilter = buildMediaScaleFilter(media);
          const ax = buildAnimationExpressions(media, "t");
          const hasAnimation = !!(ax.opacity || ax.tx || ax.ty || ax.scale);
          // Keyed layers are RGBA from the scale filter onward; never re-format to yuv420p.
          const keyed = (media as { chromaKey?: unknown }).chromaKey !== undefined;
          const keyFilter = keyed
            ? `,${buildChromaKeyFilter((media as { chromaKey: ChromaKey }).chromaKey)}`
            : "";
          const outFormat = keyed ? "rgba" : "yuv420p";

          let startPad: string;
          if (isVideo) {
            const vid = elem as NormalizedVideoElement;
            const elemStart = vid.startAt ?? 0;
            const elemDur = vid.duration ?? Math.max(0, sceneDur - elemStart);
            const fitPad = `[vid_fit_${elemIdx}]`;
            filterComplex.push(
              `[${currInputIdx}:v]${scaleFilter},trim=duration=${elemDur},setpts=PTS-STARTPTS+${elemStart}/TB,fps=${fps},setsar=1,format=${outFormat}${keyFilter}${fitPad}`
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
              `[${currInputIdx}:v]${scaleFilter},fps=${fps},setpts=PTS-STARTPTS,settb=AVTB${keyFilter}${basePad}`
            );
            startPad = basePad;
          }

          lastScenePad = applyMediaOverlay(
            filterComplex, elemIdx, startPad, media, ax, hasAnimation, sceneDur, lastScenePad
          );
        } else {
          // Text element
          const item = elem as NormalizedTextElement;
          const textOutPad = `[v_layer_${elemIdx}]`;
          const inPad = lastScenePad.startsWith("[") ? lastScenePad : `[${lastScenePad}]`;
          const filter = buildTextFilter(item, elemIdx, stagingDir, sceneDur, useTextFiles, defaultFontRef, stageAsset);

          if (hasCaptionWords(item)) {
            // Karaoke captions need the line drawn dim plus a per-word
            // highlight pass; that is a sub-graph, not a single filter.
            const textRef = useTextFiles
              ? `textfile='${escapeFFmpegStr(`text-${elemIdx}.txt`)}'`
              : undefined;
            filterComplex.push(
              ...buildKaraokeFilters(
                { ...item, __textRef: textRef, __frameWidth: width, __frameHeight: height },
                filter,
                inPad,
                textOutPad,
                sceneDur
              )
            );
          } else {
            filterComplex.push(`${inPad}${filter}${textOutPad}`);
          }
          lastScenePad = textOutPad;
        }
      }

      sceneCompPads.push(lastScenePad);
    }

    // ── Stage 3: Transitions ─────────────────────────────────────────────────
    let lastVideoPad = buildTransitionPipeline(filterComplex, norm.scenes as any, sceneCompPads, fps);

    // ── Stage 3b: Preview downscale ──────────────────────────────────────────
    // Only the output stage changes, so the scene graph (and therefore what a
    // preview shows) is identical to a full render.
    const previewHeight = resolvePreviewHeight(options?.preview);
    if (previewHeight !== undefined) {
      // `buildTransitionPipeline` returns a bracketed pad (e.g. `[bg_concat]`).
      const src = lastVideoPad.startsWith("[") ? lastVideoPad : `[${lastVideoPad}]`;
      filterComplex.push(`${src}scale=-2:${previewHeight}[vpv]`);
      // `lastVideoPad` is consumed as `-map <pad>`, which needs bracket syntax.
      lastVideoPad = "[vpv]";
    }

    // ── Stage 4: Audio ───────────────────────────────────────────────────────
    // TTS tracks are resolved to WAV paths by `resolveTtsTracks()` before
    // compile() runs, so everything here is a real file.
    const audioTracks = norm.audio;
    const audioInputIndices: number[] = [];
    for (const track of audioTracks) {
      addFFmpegInput(inputs, stageAsset(track.src), { streamLoop: track.loop });
      audioInputIndices.push(inputIndex++);
    }
    const finalAudioMap = buildAudioMix(filterComplex, audioTracks, audioInputIndices, videoElemAudioPads, duration);

    // ── Stage 5: Assemble final FFmpeg args ───────────────────────────────────
    const encoder = resolveEncoderSync(options);
    const encoderFlags =
      previewHeight !== undefined
        ? buildEncoderFlags(encoder, options?.preset ?? "ultrafast")
        : buildEncoderFlags(encoder, options?.preset);

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
