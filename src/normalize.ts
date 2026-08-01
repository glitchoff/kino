import type {
  BackgroundInput,
  BackgroundConfig,
  ElementInput,
  TextElement,
  ImageElement,
  AudioTrack,
  KinoComposition,
  NormalizedComposition,
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
  const width = comp.width || 1920;
  const height = comp.height || 1080;
  const fps = comp.fps || 30;

  const audioTracks: AudioTrack[] = normalizeAudio(comp.audio);
  const elements: ElementInput[] = [];

  let duration = comp.duration || 5;

  const scenes = (comp.scenes || []).map((scene: KinoScene, index: number) => ({
    id: scene.id || `scene-${index + 1}`,
    duration: scene.duration,
    background: normalizeBackground(scene.background),
    elements: (scene.elements || []).map(normalizeElement),
  }));

  // If scenes exist, calculate sequential scene offsets and total duration
  if (scenes.length > 0) {
    let sceneOffset = 0;
    for (const scene of scenes) {
      for (const rawElem of scene.elements) {
        const elem = { ...rawElem };
        elem.startTime = sceneOffset + (elem.startTime || 0);
        elem.duration = elem.duration || scene.duration;
        elements.push(elem);
      }
      sceneOffset += scene.duration;
    }
    duration = sceneOffset;
  }

  // Include root level elements & text
  const rawElements: any[] = [];
  if (comp.text) {
    if (Array.isArray(comp.text)) {
      rawElements.push(...comp.text);
    } else {
      rawElements.push(comp.text);
    }
  }
  if (comp.elements) {
    rawElements.push(...comp.elements);
  }
  elements.push(...rawElements.map(normalizeElement));

  const background = scenes.length > 0 ? scenes[0].background : normalizeBackground(comp.background);

  // Extract sfx from elements into audio tracks
  for (const elem of elements) {
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
    background,
    elements,
    scenes,
    audio: audioTracks,
  };
}
