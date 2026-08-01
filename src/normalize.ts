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
  const duration = comp.duration || 5;
  const fps = comp.fps || 30;

  const background = normalizeBackground(comp.background);

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

  const elements: ElementInput[] = rawElements.map(normalizeElement);

  const audioTracks: AudioTrack[] = normalizeAudio(comp.audio);

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

  const scenes = (comp.scenes || []).map((scene: KinoScene, index: number) => ({
    id: scene.id || `scene-${index + 1}`,
    duration: scene.duration,
    background: normalizeBackground(scene.background),
    elements: (scene.elements || []).map(normalizeElement),
  }));

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
