import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { getFFmpegBinaryPath, hasScaleCuda } from "../encoder/probe.js";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeComposition, selectScene } from "../normalize/index.js";
import { parseDuration, parsePixels } from "../normalize/unit-parser.js";
import { prestageRemoteAssets, KINO_VERSION, defaultAssetCacheDir } from "../remote/index.js";
import { isYtdlpSource, ytdlpUrl, fetchWithYtdlp } from "../remote/ytdlp.js";
import { isTtsSpec, synthesizeToWav, stageTts } from "../tts/piper.js";
import { packKino } from "../artifact/index.js";
import { buildAnimationExpressions } from "../animation/index.js";
import { buildSceneBackground } from "./background.js";
import { buildTextFilter, buildKaraokeFilters, hasCaptionWords } from "./elements/text.js";
import { escapeFFmpegStr } from "./position.js";
import { buildMediaScaleFilter, applyMediaOverlay, buildChromaKeyFilter } from "./elements/media.js";
import { applyBlendAndMask, needsBlendPass, hasMask } from "./elements/blend.js";
import { buildMotionBlurLayer, resolveMotionBlur } from "./elements/motion-blur.js";
import type { ChromaKey } from "./elements/media.js";
import type { ColorAdjust } from "../types/elements.js";
import { renderHtmlBatchSync } from "./elements/html.js";
import { isTakumiMarkup } from "../remote/takumi.js";
import { rasterRect, rasterEllipse, rasterLine } from "./elements/shapes.js";
import { buildColorFilter, isNeutralColor } from "./elements/color.js";
import { buildTransitionPipeline } from "./transitions.js";
import { buildAudioMix } from "./audio.js";
import { resolveEncoderSync, buildEncoderFlags } from "./encoder-flags.js";
import { resolvePreviewHeight } from "../types/render.js";
import { scratchDir } from "./scratch.js";

/**
 * Longest filtergraph passed on the command line.
 *
 * Windows stores a command line in a 16-bit length field, so `CreateProcess`
 * rejects anything past 32,767 characters with ENAMETOOLONG. POSIX uses
 * ARG_MAX (~2 MB, shared with the environment).
 *
 * The Windows figure leaves headroom for the rest of the argv — inputs, encoder
 * flags, output path — under that ceiling. A graph between the two numbers is
 * the case that used to fail: too long to spawn, too short to be written out.
 */
const FILTERGRAPH_ARG_LIMIT = process.platform === "win32" ? 30_000 : 100_000;
const FILTERGRAPH_SCRIPT_NAME = "filtergraph.txt";
import type {
  KinoComposition,
  RenderOptions,
  CompileResult,
  NormalizedHtmlElement,
  NormalizedImageElement,
  NormalizedVideoElement,
  NormalizedTextElement,
  NormalizedShapeElement,
} from "../types/index.js";

// Walk up to the package root: unbundled this module sits at `src/pipeline/`,
// in the tsup bundle at `dist/`. Assuming either depth misses the other and
// leaves `defaultFontRef` undefined, which does not fail — drawtext silently
// uses its own default font instead of the bundled one. The file is
// `Inter-Regular.ttf`; the old `inter-regular.ttf` never existed.
const DEFAULT_FONT_PATH = (() => {
  let dir = resolve(
    typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url))
  );
  for (let i = 0; i < 5; i++) {
    for (const name of ["Inter-Regular.ttf", "inter-regular.ttf"]) {
      const path = join(dir, "assets", name);
      if (existsSync(path)) return path;
    }
    dir = dirname(dir);
  }
  return undefined;
})();

/**
 * Re-expresses an element's geometry in preview space.
 *
 * A preview composites on a smaller frame, so an element's `width`, `height`,
 * `x` and `y` all have to be scaled by the same ratio or the layout drifts —
 * a centred element would sit off-centre, and a full-frame panel would spill
 * past the edge. Scaling the numbers keeps `overlay`'s `main_w - overlay_w`
 * centring correct, which inserting a `scale=` filter would not.
 *
 * Returns `{}` at ratio 1, so a full render is byte-identical to before.
 */
function previewScale(
  elem: { width?: unknown; height?: unknown; x?: unknown; y?: unknown },
  ratio: number
): Record<string, number> {
  if (ratio >= 1) return {};
  const scale = (v: unknown): number | undefined => {
    if (typeof v !== "string" && typeof v !== "number") return undefined;
    const n = parsePixels(v);
    if (n === undefined || n === null) return undefined;
    return Math.max(1, Math.round(n * ratio));
  };
  const out: Record<string, number> = {};
  const w = scale(elem.width);
  const h = scale(elem.height);
  const x = scale(elem.x);
  const y = scale(elem.y);
  if (w !== undefined) out.width = w;
  if (h !== undefined) out.height = h;
  if (x !== undefined) out.x = x;
  if (y !== undefined) out.y = y;
  return out;
}

/**
 * End of a still element's on-screen window, in seconds from the scene start,
 * or `undefined` when it cannot be bounded.
 *
 * Returns `undefined` — meaning "no trim" — unless the element has an explicit
 * `duration`. An element that runs to the end of its scene is already bounded
 * by the scene's own length, and one with neither option is visible throughout,
 * so trimming either would be guesswork. The overlay's `enable=between()`
 * remains the authority on visibility; this only stops needless decoding.
 */
function stillWindow(
  elem: { startAt?: number | string; duration?: number | string },
  sceneDur: number
): string | undefined {
  const dur = parseDuration(elem.duration);
  if (dur === undefined) return undefined;
  const start = parseDuration(elem.startAt) ?? 0;
  const end = Math.min(sceneDur, start + dur);
  if (!(end > 0)) return undefined;
  // Fixed precision: a long float here bloats the filtergraph, and the graph is
  // already the thing that overflows Windows' command line.
  return end.toFixed(3);
}

function addFFmpegInput(
  inputs: string[],
  src: string,
  options: { loop?: boolean; streamLoop?: boolean; seek?: number; rawSize?: string } = {}
): void {
  if (options.streamLoop) inputs.push("-stream_loop", "-1");
  if (options.seek !== undefined && options.seek > 0) inputs.push("-ss", String(options.seek));
  // A raw still loops a decoded buffer: the JPEG is decoded once, not per frame.
  if (options.loop) {
    if (options.rawSize) {
      inputs.push("-f", "rawvideo", "-pix_fmt", "rgba", "-s", options.rawSize, "-stream_loop", "-1");
    } else {
      inputs.push("-loop", "1");
    }
  }
  if (src.startsWith("http://") || src.startsWith("https://")) {
    inputs.push(
      "-user_agent",
      `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Kino/${KINO_VERSION}`
    );
  }
  inputs.push("-i", src);
}

/**
 * Decode a still to raw RGBA once, so the filtergraph can loop the buffer
 * instead of asking ffmpeg to re-decode the JPEG for every frame.
 *
 * `-loop 1 -i panel.jpg` decodes the image on every output frame. A 3.5s hold
 * at 30fps is 105 decodes of the same pixels. Decoding to raw costs one decode
 * plus a larger file in the staging dir, and the loop then copies bytes.
 *
 * Measured on a 1200x1758 JPEG, 300 frames: 2.30s -> 0.67s.
 * Returns the raw file name and its `WxH`, or undefined if the probe failed.
 */
function decodeStillToRaw(
  src: string,
  stagingDir: string,
  counter: number
): { name: string; size: string } | undefined {
  const probe = spawnSync(getFFmpegBinaryPath(), [
    "-hide_banner",
    "-v",
    "error",
    "-i",
    src,
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    join(stagingDir, `still-${counter}.raw`),
  ]);
  if (probe.status !== 0) return undefined;

  const info = spawnSync(getFFmpegBinaryPath(), ["-hide_banner", "-i", src], { encoding: "utf8" });
  const text = `${info.stderr ?? ""}`;
  const dims = text.match(/,\s(\d{2,5})x(\d{2,5})[\s,]/);
  if (!dims) return undefined;
  return { name: `still-${counter}.raw`, size: `${dims[1]}x${dims[2]}` };
}

export function compile(composition: KinoComposition, options?: Partial<RenderOptions>): CompileResult {
  let norm = normalizeComposition(composition);
  if (options?.scene) norm = selectScene(norm, options.scene);
  const { width, height, duration, fps } = norm;
  const output = options?.output || "./out.mp4";

  const stagingDir = scratchDir("stage-", { outputPath: output, ram: options?.ram });
  const assetNames = new Map<string, string>();
  let assetCounter = 0;
  let rawStillCounter = 0;

  const assetCacheDir =
    options?.assetCache === false
      ? undefined
      : options?.assetCacheDir ?? defaultAssetCacheDir();

  const remoteAssets = prestageRemoteAssets(stagingDir, norm, {
    cache: options?.assetCache,
    cacheDir: options?.assetCacheDir,
  });

  let defaultFontRef: string | undefined;
  if (DEFAULT_FONT_PATH) {
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

  const allHtmlElements = norm.elements.filter(
    (elem): elem is NormalizedHtmlElement => elem.type === "html"
  );
  // `tak:` markup goes to Takumi and never touches a browser; everything else
  // takes the existing Chrome/Obscura path unchanged.
  const htmlElements = allHtmlElements.filter((elem) => !isTakumiMarkup(elem.html));
  const htmlPaths = renderHtmlBatchSync(
    htmlElements as any,
    stagingDir,
    options?.browserPath,
    options?.browser,
    options?.browserUrl
  );
  const htmlPathMap = new Map(htmlElements.map((elem, index) => [elem, htmlPaths[index]]));
  // Takumi is async; compile() is sync, so this is resolved by the caller before
  // compile runs. See `renderTakumiBatch`.
  // Keyed by index in `norm.elements`, not by element identity: the caller
  // normalized separately and built its own objects.
  const takumiPathMap = (options?.takumiRenders ?? new Map<number, string>()) as Map<number, string>;
  const takumiIndexByElement = new Map<NormalizedHtmlElement, number>();
  norm.elements.forEach((el, index) => {
    if (el.type === "html" && isTakumiMarkup(el.html)) takumiIndexByElement.set(el, index);
  });

  // Shapes are static, so each is drawn once to a PNG and then overlaid by the
  // image path. No browser, no second rendering model.
  const shapeElements = norm.elements.filter(
    (elem): elem is NormalizedShapeElement => elem.type === "shape"
  );
  const shapePathMap = new Map<NormalizedShapeElement, string>();
  shapeElements.forEach((shape, index) => {
    const out = join(stagingDir, `shape-${index}.png`);
    const width = Math.max(1, Math.round(shape.width));
    const height = Math.max(1, Math.round(shape.height));
    const opts = { out, width, height, workDir: stagingDir, ffmpegPath: options?.ffmpegPath };
    if (shape.shape === "ellipse") {
      rasterEllipse(opts, { fill: shape.fill, stroke: shape.stroke, strokeWidth: shape.strokeWidth });
    } else if (shape.shape === "line") {
      rasterLine(opts, {
        x1: shape.x1 ?? 0,
        y1: shape.y1 ?? 0,
        x2: shape.x2 ?? width,
        y2: shape.y2 ?? height,
        stroke: shape.stroke ?? shape.fill ?? "#ffffff",
        strokeWidth: shape.strokeWidth ?? 2,
      });
    } else {
      rasterRect(opts, {
        fill: shape.fill,
        stroke: shape.stroke,
        strokeWidth: shape.strokeWidth,
        radius: shape.radius,
      });
    }
    shapePathMap.set(shape, out);
  });

  try {
    // A preview is downscaled at the source, not at the output.
    //
    // Appending `scale=-2:H` after the whole graph (Stage 3b) meant every scene,
    // transition and overlay ran at full resolution and the result was thrown
    // away at the end — a 144p preview cost 1080p work. Downscaling each element
    // and background on entry makes the per-frame cost scale with the preview
    // size, which is what makes `--preview` a usable iteration tool.
    //
    // The scene graph itself is unchanged: same elements, same order, same
    // timings. Only the pixel grid they are composited on differs, so a preview
    // still shows what the full render will.
    const previewHeight = resolvePreviewHeight(options?.preview);
    const pw = previewHeight !== undefined ? Math.max(2, Math.round((width * previewHeight) / height / 2) * 2) : width;
    const ph = previewHeight !== undefined ? previewHeight : height;

    // Resample on the GPU when this machine can.
    //
    // Default OFF: measured *slower* end to end (44.5s vs 39.1s on a 36s 1080p
    // bench) despite `scale_cuda` winning 3x in isolation. `zoompan` and
    // `drawtext` are CPU-only, so every element pays an upload and a download
    // per frame, and that round trip costs more than the resize saves. Opt in
    // with `scaleCuda: true` when the graph has no CPU-only filters in the
    // chain — a pure still compositing pipeline, for instance.
    const useScaleCuda =
      options?.scaleCuda === true && hasScaleCuda(getFFmpegBinaryPath(options?.ffmpegPath));

    // ── Stage 1: Per-scene backgrounds ──────────────────────────────────────
    const sceneBgPads: string[] = [];

    for (let i = 0; i < norm.scenes.length; i++) {
      const scene = norm.scenes[i];
      const bgPad = `[bg_scene_${i}]`;
      const currInputIdx = inputIndex++;

      buildSceneBackground(inputs, filterComplex, scene.background, pw, ph, fps, scene.duration, bgPad, currInputIdx, {
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
        const isImage = elem.type === "image" || elem.type === "html" || elem.type === "shape";
        const isVideo = elem.type === "video";

        if (isImage || isVideo) {
          const media =
            elem.type === "html"
              ? ({
                  ...elem,
                  type: "image",
                  src:
                    htmlPathMap.get(elem as NormalizedHtmlElement) ??
                    takumiPathMap.get(takumiIndexByElement.get(elem as NormalizedHtmlElement)!) ??
                    (() => {
                      throw new Error(
                        "`tak:` markup reached compile() without a pre-rendered PNG. " +
                          "Render through render() or exportComposition(), which run Takumi first."
                      );
                    })(),
                } as NormalizedImageElement)
              : elem.type === "shape"
                ? ({ ...elem, type: "image", src: shapePathMap.get(elem)! } as NormalizedImageElement)
                : (elem as NormalizedImageElement | NormalizedVideoElement);
          const currInputIdx = inputIndex++;

          if (isVideo) {
            const vid = elem as NormalizedVideoElement;
            addFFmpegInput(inputs, stageAsset(vid.src), { seek: vid.trimStart, streamLoop: vid.loop });
          } else {
            // Loop a still so it has a frame for the whole timeline. Without
            // this the input is a single frame at t=0, and the `fps=` below
            // resamples that one frame into nothing — the overlay then finds no
            // image to place and every static image renders invisible.
            addFFmpegInput(inputs, stageAsset(media.src), { loop: true });
          }

          // A shape is a PNG with transparency around the drawn region; `media`
          // is already `type: "image"` by here, so the flag has to be passed.
          // Colour adjustment runs after scaling and before any key, so the
          // numbers mean the same thing regardless of the element's size.
          const colorFilter = isNeutralColor((elem as { grade?: ColorAdjust }).grade)
            ? ""
            : buildColorFilter((elem as { grade?: ColorAdjust }).grade, stageAsset);
          const scaleFilter =
            buildMediaScaleFilter({
              ...media,
              ...previewScale(media, pw / width),
              cuda: useScaleCuda,
              preserveAlpha: elem.type === "shape" || undefined,
            }) + (colorFilter ? `,${colorFilter}` : "");
          const ax = buildAnimationExpressions(media, "t");
          const hasAnimation = !!(ax.opacity || ax.tx || ax.ty || ax.scale);
          // RGBA from the scale filter onward; never re-format to yuv420p or the
          // alpha is dropped. Shapes need this without a chroma key, so the two
          // concerns are separate.
          const keyed = (media as { chromaKey?: unknown }).chromaKey !== undefined;
          const needsAlpha = keyed || elem.type === "shape";
          const keyFilter = keyed
            ? `,${buildChromaKeyFilter((media as { chromaKey: ChromaKey }).chromaKey)}`
            : "";
          const outFormat = needsAlpha ? "rgba" : "yuv420p";

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
            // A still loops for the whole timeline, so without a bound it keeps
            // decoding long after its element is off screen. `enable=between()`
            // in the overlay only hides the result; ffmpeg still runs the whole
            // branch every frame. Trimming to the element's own window drops the
            // work — a panel on screen for 6s in a 238s timeline used to cost
            // 238s of decode.
            //
            // The trim is deliberately on the filter, not `-t` on the input:
            // inputs stay exactly as they were, so a mis-sized window can only
            // shorten one layer, never starve a later scene (see the black-frame
            // regression in paper-ghost findings, 2026-11-20).
            //
            // `setpts` rebases the trimmed output to t=0 so the overlay still
            // sees the still at the scene's own clock. Trimming never moves it:
            // the first frame is at t=0 and the overlay's `enable` decides
            // visibility.
            const stillWin = stillWindow(media, sceneDur);
            const trimFilter = stillWin ? `,trim=end=${stillWin}` : "";
            filterComplex.push(
              `[${currInputIdx}:v]${scaleFilter},fps=${fps}${trimFilter},setpts=PTS-STARTPTS,settb=AVTB${keyFilter}${basePad}`
            );
            startPad = basePad;
          }

          const elemBlend = (elem as { blend?: any; mask?: any; motionBlur?: any });
          const blur = resolveMotionBlur(elemBlend.motionBlur);
          if (blur) {
            // Sample the element's transform across the shutter, average, then
            // composite once. Only this element's layer is sampled, so cost
            // scales with blurred elements rather than with the composition.
            const blurredPad = buildMotionBlurLayer(
              filterComplex, elemIdx, startPad, lastScenePad, media,
              ax, hasAnimation, sceneDur, width, height, fps, blur
            );
            lastScenePad = applyBlendAndMask(
              filterComplex, elemIdx, blurredPad, lastScenePad, true,
              { blend: elemBlend.blend, mask: elemBlend.mask }, {}, false,
              sceneDur, width, height, fps
            );
          } else if (needsBlendPass(elemBlend.blend) || hasMask(elemBlend.mask)) {
            const maskInputIdx = elemBlend.mask?.src ? inputIndex++ : undefined;
            if (maskInputIdx !== undefined) {
              // A matte is a still; loop it so it has a frame for the whole
              // timeline, exactly like any other image input.
              addFFmpegInput(inputs, stageAsset(elemBlend.mask.src), { loop: true });
            }
            lastScenePad = applyBlendAndMask(
              filterComplex, elemIdx, startPad, lastScenePad, false, media, ax, hasAnimation,
              sceneDur, pw, ph, fps, maskInputIdx
            );
          } else {
            lastScenePad = applyMediaOverlay(
              filterComplex, elemIdx, startPad, media, ax, hasAnimation, sceneDur, lastScenePad,
              { width: pw, height: ph, fps }, needsAlpha
            );
          }
        } else {
          // Text element
          const item = elem as NormalizedTextElement;
          const textOutPad = `[v_layer_${elemIdx}]`;
          const elemBlend = (elem as { blend?: any; mask?: any; motionBlur?: any });
          const textBlur = resolveMotionBlur(elemBlend.motionBlur);
          const special = needsBlendPass(elemBlend.blend) || hasMask(elemBlend.mask) || !!textBlur;

          // `drawtext` paints onto its input, so blending or masking text means
          // giving it a blank transparent frame to paint on and compositing the
          // result — the same treatment media elements get.
          let inPad: string;
          if (special) {
            const canvas = `[txt_canvas_${elemIdx}]`;
            filterComplex.push(
              `color=c=black@0.0:s=${pw}x${ph}:r=${fps}:d=${sceneDur},format=rgba,settb=AVTB${canvas}`
            );
            inPad = canvas;
          } else {
            inPad = lastScenePad.startsWith("[") ? lastScenePad : `[${lastScenePad}]`;
          }

          // Text is drawn straight onto the frame, so a preview has to shrink
          // the font and move the position with it — otherwise the text is full
          // size on a tiny canvas and runs off the edge.
          const previewText = previewScale({ width: item.fontSize, x: item.x, y: item.y }, pw / width);
          const textItem =
            pw === width
              ? item
              : {
                  ...item,
                  fontSize: previewText.width ?? item.fontSize,
                  x: previewText.x ?? item.x,
                  y: previewText.y ?? item.y,
                };
          const filter = buildTextFilter(textItem, elemIdx, stagingDir, sceneDur, useTextFiles, defaultFontRef, stageAsset);

          if (hasCaptionWords(item)) {
            // Karaoke captions need the line drawn dim plus a per-word
            // highlight pass; that is a sub-graph, not a single filter.
            const textRef = useTextFiles
              ? `textfile='${escapeFFmpegStr(`text-${elemIdx}.txt`)}'`
              : undefined;
            filterComplex.push(
              ...buildKaraokeFilters(
                { ...textItem, __textRef: textRef, __frameWidth: pw, __frameHeight: ph },
                filter,
                inPad,
                textOutPad,
                sceneDur
              )
            );
          } else {
            filterComplex.push(`${inPad}${filter}${textOutPad}`);
          }

          if (special) {
            const maskInputIdx = elemBlend.mask?.src ? inputIndex++ : undefined;
            if (maskInputIdx !== undefined) {
              addFFmpegInput(inputs, stageAsset(elemBlend.mask.src), { loop: true });
            }
            // Text is painted by drawtext at its final position, so it is
            // already full-frame and needs no second placement. Motion blur
            // runs on the painted layer, same as on a media layer.
            let layerPad = textOutPad;
            if (textBlur) {
              const blurPad = `[txt_blur_${elemIdx}]`;
              filterComplex.push(
                `${layerPad}tmix=frames=${Math.max(2, Math.round(textBlur.samples * textBlur.shutter * 2))}${blurPad}`
              );
              layerPad = blurPad;
            }
            lastScenePad = applyBlendAndMask(
              filterComplex, elemIdx, layerPad, lastScenePad, true,
              { blend: elemBlend.blend, mask: elemBlend.mask }, {}, false,
              sceneDur, width, height, fps, maskInputIdx
            );
          } else {
            lastScenePad = textOutPad;
          }
        }
      }

      sceneCompPads.push(lastScenePad);
    }

    // ── Stage 3: Transitions ─────────────────────────────────────────────────
    let lastVideoPad = buildTransitionPipeline(filterComplex, norm.scenes as any, sceneCompPads, fps);

    // ── Stage 3a: Composition grade ──────────────────────────────────────────
    // One pass over the finished frame, after every scene and transition, so a
    // look holds across the whole video. A preview grades its own smaller frame,
    // so the look is the same, just at lower resolution.
    if (norm.grade && !isNeutralColor(norm.grade)) {
      const gradeFilter = buildColorFilter(norm.grade, stageAsset);
      if (gradeFilter) {
        const src = lastVideoPad.startsWith("[") ? lastVideoPad : `[${lastVideoPad}]`;
        filterComplex.push(`${src}${gradeFilter}[vgraded]`);
        lastVideoPad = "[vgraded]";
      }
    }

    // No output-stage downscale: a preview already composites on a smaller
    // frame, so the finished pad is the preview size.

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
        ? buildEncoderFlags(encoder, options?.preset ?? "ultrafast", options?.crf)
        : buildEncoderFlags(encoder, options?.preset, options?.crf);

    const args: string[] = ["-y", ...inputs];
    let filtergraphStr: string | undefined;

    if (filterComplex.length > 0) {
      filtergraphStr = filterComplex.join(";");
      // A long caption track produces a filtergraph far past the OS argument
      // limit (E2BIG, typically 2 MB), which fails at spawn with no useful
      // error. Handing ffmpeg a script file keeps the graph off the command
      // line, so graph size no longer limits a composition.
      if (filtergraphStr.length > FILTERGRAPH_ARG_LIMIT) {
        // Written into the staging dir, which is packed into the .kino and
        // extracted at render time; ffmpeg then runs with that as its cwd, so
        // the basename is the whole path it needs.
        writeFileSync(join(stagingDir, FILTERGRAPH_SCRIPT_NAME), filtergraphStr, "utf8");
        args.push("-filter_complex_script", FILTERGRAPH_SCRIPT_NAME);
      } else {
        args.push("-filter_complex", filtergraphStr);
      }
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
