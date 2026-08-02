import { validateComposition } from "./validate.js";
import type {
  BackgroundInput,
  BackgroundConfig,
  ElementInput,
  TextElement,
  ImageElement,
  AudioTrack,
  KinoComposition,
  NormalizedComposition,
  NormalizedScene,
  KinoScene,
} from "./types.js";

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

  if (elem.type === "image") {
    const img: ImageElement = {
      type: "image",
      src: elem.src || "",
      x: elem.x,
      y: elem.y,
      width: elem.width,
      height: elem.height,
      fit: elem.fit,
      startTime: elem.startTime,
      duration: elem.duration,
      sfx: elem.sfx,
      zIndex: elem.zIndex,
      animation: elem.animation,
    };
    return img;
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
  validateComposition(comp);

  const width = comp.width || 1920;
  const height = comp.height || 1080;
  const fps = comp.fps || 30;
  const timeline = comp.timeline || "sequential";

  const audioTracks: AudioTrack[] = normalizeAudio(comp.audio);
  const normalizedScenes: NormalizedScene[] = [];
  const flattenedElements: ElementInput[] = [];

  let duration = 0;

  if (timeline === "absolute") {
    for (let i = 0; i < comp.scenes.length; i++) {
      const scene = comp.scenes[i];
      const sceneStart = scene.startTime ?? 0;
      const sceneDur = scene.duration || 5;
      if (sceneStart + sceneDur > duration) {
        duration = sceneStart + sceneDur;
      }

      const normBg = normalizeBackground(scene.background);
      const normElems = (scene.elements || []).map(normalizeElement);

      normalizedScenes.push({
        id: scene.id || `scene-${i + 1}`,
        startTime: sceneStart,
        duration: sceneDur,
        background: normBg,
        elements: normElems,
      });

      for (const rawElem of normElems) {
        const elem = { ...rawElem };
        const relStart = elem.startTime ?? 0;
        elem.startTime = sceneStart + relStart;
        elem.duration = elem.duration ?? Math.max(0, sceneDur - relStart);
        flattenedElements.push(elem);
      }
    }
  } else {
    // Sequential timeline (default)
    let currentOffset = 0;
    for (let i = 0; i < comp.scenes.length; i++) {
      const scene = comp.scenes[i];
      const sceneDur = scene.duration || 5;
      const sceneStart = currentOffset;
      currentOffset += sceneDur;

      const normBg = normalizeBackground(scene.background);
      const normElems = (scene.elements || []).map(normalizeElement);

      normalizedScenes.push({
        id: scene.id || `scene-${i + 1}`,
        startTime: sceneStart,
        duration: sceneDur,
        background: normBg,
        elements: normElems,
      });

      for (const rawElem of normElems) {
        const elem = { ...rawElem };
        const relStart = elem.startTime ?? 0;
        elem.startTime = sceneStart + relStart;
        elem.duration = elem.duration ?? Math.max(0, sceneDur - relStart);
        flattenedElements.push(elem);
      }
    }
    duration = currentOffset;
  }

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
    timeline,
    background: normalizedScenes[0].background,
    elements: sortedElements,
    scenes: normalizedScenes,
    audio: audioTracks,
  };
}
