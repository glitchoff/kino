import { validateComposition } from "../validate/index.js";
import type {
  KinoComposition,
  KinoScene,
  KinoTemplate,
  ElementInput,
  AudioTrack,
  NormalizedComposition,
  NormalizedScene,
} from "../types/index.js";
import { normalizeBackground } from "./background.js";
import { normalizeElement } from "./element.js";
import { normalizeAudio } from "./audio.js";

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
