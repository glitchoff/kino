import { validateComposition } from "./validate.js";
import type {
  BackgroundInput,
  BackgroundConfig,
  ElementInput,
  TextElement,
  ImageElement,
  VideoElement,
  AudioTrack,
  KinoComposition,
  NormalizedComposition,
  NormalizedScene,
  KinoScene,
  KinoTemplate,
  TemplateProps,
} from "./types.js";

function resolveTemplate(
  templateId: string,
  templates: Map<string, KinoTemplate>
): KinoTemplate {
  const tmpl = templates.get(templateId);
  if (!tmpl) {
    throw new Error(`Unknown template reference: "${templateId}"`);
  }
  return tmpl;
}

function deepMerge<T extends Record<string, unknown>>(
  base: T,
  override: Partial<T>
): T {
  const result = { ...base } as T;
  for (const key of Object.keys(override) as (keyof T)[]) {
    const val = override[key];
    if (
      val !== undefined &&
      typeof val === "object" &&
      !Array.isArray(val) &&
      val !== null &&
      typeof base[key] === "object" &&
      base[key] !== null &&
      !Array.isArray(base[key])
    ) {
      result[key] = deepMerge(
        base[key] as Record<string, unknown>,
        val as Record<string, unknown>
      ) as T[keyof T];
    } else {
      result[key] = val as T[keyof T];
    }
  }
  return result;
}

function applyTemplate(
  elem: any,
  templates: Map<string, KinoTemplate>
): any {
  const templateId = elem.template;
  if (!templateId) return elem;

  const tmpl = resolveTemplate(templateId, templates);

  if (elem.type && elem.type !== tmpl.type) {
    throw new Error(
      `Template "${templateId}" is type "${tmpl.type}" but element type is "${elem.type}"`
    );
  }

  const merged = deepMerge(tmpl.props as Record<string, unknown>, elem as Record<string, unknown>);
  delete (merged as Record<string, unknown>).template;
  return merged;
}

export function normalizeBackground(bg?: BackgroundInput): BackgroundConfig {
  if (!bg) {
    return { type: "color", value: "#000000" };
  }
  if (typeof bg === "string") {
    return { type: "color", value: bg };
  }
  return bg;
}

function getCharWidth(char: string, fontSize: number): number {
  if ("WwM@#%&".includes(char)) return fontSize * 0.8;
  if ("ilmI'|!.,:;()[]{}t-`".includes(char)) return fontSize * 0.28;
  if (char >= "A" && char <= "Z") return fontSize * 0.65;
  if (char === " ") return fontSize * 0.3;
  return fontSize * 0.52;
}

export function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of text) {
    width += getCharWidth(ch, fontSize);
  }
  return width;
}

export function wrapText(content: string, fontSize: number, maxWidth?: number): string {
  if (!maxWidth || maxWidth <= 0 || !content) return content;

  const existingLines = content.split("\n");
  const wrappedLines: string[] = [];

  for (const line of existingLines) {
    if (estimateTextWidth(line, fontSize) <= maxWidth) {
      wrappedLines.push(line);
      continue;
    }

    const words = line.split(" ");
    let currentLine = "";

    for (const word of words) {
      if (!currentLine) {
        currentLine = word;
      } else {
        const testLine = `${currentLine} ${word}`;
        if (estimateTextWidth(testLine, fontSize) <= maxWidth) {
          currentLine = testLine;
        } else {
          wrappedLines.push(currentLine);
          currentLine = word;
        }
      }
    }
    if (currentLine) {
      wrappedLines.push(currentLine);
    }
  }

  return wrappedLines.join("\n");
}

export function normalizeElement(elem: any): ElementInput {
  if (!elem) {
    return { type: "text", content: "" };
  }

  const startAt = elem.startAt ?? elem.startTime;

  if (elem.type === "image") {
    const img: ImageElement = {
      type: "image",
      src: elem.src || "",
      x: elem.x,
      y: elem.y,
      offsetX: elem.offsetX,
      offsetY: elem.offsetY,
      width: elem.width,
      height: elem.height,
      fit: elem.fit,
      startAt,
      startTime: elem.startTime,
      duration: elem.duration,
      sfx: elem.sfx,
      zIndex: elem.zIndex,
      animation: elem.animation,
    };
    return img;
  }

  if (elem.type === "video") {
    const fit = elem.fit ?? "contain";
    const vid: VideoElement = {
      type: "video",
      src: elem.src || "",
      x: elem.x,
      y: elem.y,
      offsetX: elem.offsetX,
      offsetY: elem.offsetY,
      width: elem.width,
      height: elem.height,
      fit,
      trimStart: elem.trimStart,
      loop: elem.loop,
      volume: elem.volume,
      startAt,
      startTime: elem.startTime,
      duration: elem.duration,
      sfx: elem.sfx,
      zIndex: elem.zIndex,
      animation: elem.animation,
    };
    return vid;
  }

  if (elem.maxWidth !== undefined && elem.maxWidth <= 0) {
    throw new Error(`Invalid TextElement 'maxWidth': ${elem.maxWidth}. Must be greater than 0.`);
  }
  if (elem.lineHeight !== undefined && elem.lineHeight <= 0) {
    throw new Error(`Invalid TextElement 'lineHeight': ${elem.lineHeight}. Must be greater than 0.`);
  }
  if (elem.stroke?.width !== undefined && elem.stroke.width < 0) {
    throw new Error(`Invalid TextElement 'stroke.width': ${elem.stroke.width}. Must be non-negative.`);
  }

  const rawContent = elem.content || "";
  const fontSize = elem.fontSize ?? 48;
  const content = elem.maxWidth ? wrapText(rawContent, fontSize, elem.maxWidth) : rawContent;

  const text: TextElement = {
    type: "text",
    content,
    fontSize: elem.fontSize,
    fontColor: elem.fontColor,
    fontFile: elem.fontFile,
    box: elem.box,
    boxColor: elem.boxColor,
    boxPadding: elem.boxPadding,
    maxWidth: elem.maxWidth,
    textAlign: elem.textAlign,
    lineHeight: elem.lineHeight,
    stroke: elem.stroke,
    shadow: elem.shadow,
    x: elem.x,
    y: elem.y,
    offsetX: elem.offsetX,
    offsetY: elem.offsetY,
    startAt,
    startTime: elem.startTime,
    duration: elem.duration,
    sfx: elem.sfx,
    zIndex: elem.zIndex,
    animation: elem.animation,
  };
  return text;
}

export function normalizeAudio(audio?: AudioTrack | AudioTrack[]): AudioTrack[] {
  if (!audio) return [];
  if (Array.isArray(audio)) return audio;
  return [audio];
}

export function normalizeComposition(comp: KinoComposition): NormalizedComposition {
  const width = comp.width || 1920;
  const height = comp.height || 1080;
  const fps = comp.fps || 30;

  const audioTracks: AudioTrack[] = normalizeAudio(comp.audio);
  const normalizedScenes: NormalizedScene[] = [];
  const flattenedElements: ElementInput[] = [];

  const templates = new Map<string, KinoTemplate>();
  for (const tmpl of comp.templates || []) {
    templates.set(tmpl.id, tmpl);
  }

  const resolvedScenes: KinoScene[] = [];
  for (let i = 0; i < comp.scenes.length; i++) {
    const scene = comp.scenes[i];
    const resolvedElems: ElementInput[] = [];
    for (const rawElem of scene.elements || []) {
      const resolved = applyTemplate(rawElem, templates);
      resolvedElems.push(resolved as ElementInput);
    }
    resolvedScenes.push({ ...scene, elements: resolvedElems });
  }

  const resolvedComp: KinoComposition = {
    width: comp.width,
    height: comp.height,
    fps: comp.fps,
    scenes: resolvedScenes,
    audio: comp.audio,
  };
  validateComposition(resolvedComp);

  let currentOffset = 0;
  for (let i = 0; i < resolvedScenes.length; i++) {
    const scene = resolvedScenes[i];
    const sceneDur = scene.duration;
    const transDuration = i > 0 && scene.transition ? scene.transition.duration : 0;

    if (i > 0) {
      currentOffset -= transDuration;
    }
    const sceneStart = currentOffset;
    currentOffset += sceneDur;

    const normBg = normalizeBackground(scene.background);
    const normElems: ElementInput[] = [];

    for (const rawElem of scene.elements || []) {
      const elem = normalizeElement(rawElem);
      const relStart = elem.startAt ?? elem.startTime ?? 0;
      elem.startAt = relStart;
      elem.startTime = sceneStart + relStart;
      elem.duration = elem.duration ?? Math.max(0, sceneDur - relStart);
      normElems.push(elem);
      flattenedElements.push(elem);
    }

    normalizedScenes.push({
      id: scene.id || `scene-${i + 1}`,
      startTime: sceneStart,
      duration: sceneDur,
      background: normBg,
      elements: normElems,
      transition: scene.transition,
    });
  }

  const duration = currentOffset;

  // Stable z-order sort: zIndex wins when set, otherwise declaration order.
  // Negative values clamp to 0.
  const sortedElements = flattenedElements
    .map((elem, index) => ({ elem, index }))
    .sort((a, b) => {
      const za = a.elem.zIndex === undefined ? a.index : Math.max(0, a.elem.zIndex);
      const zb = b.elem.zIndex === undefined ? b.index : Math.max(0, b.elem.zIndex);
      return za - zb;
    })
    .map(({ elem }) => elem);

  // Extract sfx from elements into audio tracks
  for (const elem of flattenedElements) {
    if (elem.sfx) {
      if (typeof elem.sfx === "string") {
        audioTracks.push({
          src: elem.sfx,
          startTime: elem.startTime || 0,
        });
      } else if (typeof elem.sfx === "object") {
        audioTracks.push({
          ...elem.sfx,
          startTime: elem.sfx.startTime ?? elem.startTime ?? 0,
        });
      }
    }
  }

  return {
    width,
    height,
    duration,
    fps,
    background: normalizedScenes[0].background,
    elements: sortedElements,
    scenes: normalizedScenes,
    audio: audioTracks,
  };
}
