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
      startTime: elem.startTime,
      duration: elem.duration,
      sfx: elem.sfx,
    };
    return img;
  }

  const text: TextElement = {
    type: "text",
    content: elem.content || "",
    fontSize: elem.fontSize,
    fontColor: elem.fontColor,
    fontFile: elem.fontFile,
    box: elem.box,
    boxColor: elem.boxColor,
    boxPadding: elem.boxPadding,
    x: elem.x,
    y: elem.y,
    startTime: elem.startTime,
    duration: elem.duration,
    sfx: elem.sfx,
  };
  return text;
}

export function normalizeAudio(audio?: AudioTrack | AudioTrack[]): AudioTrack[] {
  if (!audio) return [];
  if (Array.isArray(audio)) return audio;
  return [audio];
}

export function normalizeComposition(comp: KinoComposition): NormalizedComposition {
  if (!comp.scenes || !Array.isArray(comp.scenes) || comp.scenes.length === 0) {
    throw new Error(
      "Invalid KinoComposition: 'scenes' array is required and must contain at least one scene."
    );
  }

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
    elements: flattenedElements,
    scenes: normalizedScenes,
    audio: audioTracks,
  };
}
