import { validateComposition } from "../validate/index.js";
import type {
  KinoComposition,
  KinoScene,
  KinoTemplate,
  ElementInput,
  NarrationFit,
  NormalizedComposition,
  NormalizedScene,
  NormalizedElement,
  NormalizedAudioTrack,
  SceneDuration,
} from "../types/index.js";
import { normalizeBackground } from "./background.js";
import { normalizeElement } from "./element.js";
import { normalizeAudio, resolveDucking } from "./audio.js";
import { parseDuration, parseFps, parsePixels, parseVolume } from "./unit-parser.js";

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

/** Default tail added after speech when a scene is fitted to narration. */
export const NARRATION_PAD = 0.6;

function isNarrationFit(value: SceneDuration): value is NarrationFit {
  return typeof value === "object" && value !== null && "fit" in value;
}

/**
 * Turns `duration: { fit: voice }` into a plain number.
 *
 * Fitting happens here, before any timing maths, so scene offsets, transition
 * overlap and element defaults all see a normal duration. The `Voice` must
 * already be measured — that is what `await voice()` is for — so a fit is
 * resolved synchronously and the rest of the pipeline stays synchronous.
 */
export function resolveSceneDuration(duration: SceneDuration): number | string {
  if (!isNarrationFit(duration)) return duration;

  const seconds = duration.fit.seconds;
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`A narration fit needs a measured voice (got ${seconds} seconds). Did you await voice()?`);
  }
  const pad = duration.pad ?? NARRATION_PAD;
  const lead = duration.lead ?? 0;
  const total = lead + seconds + pad;
  return duration.min !== undefined ? Math.max(duration.min, total) : total;
}

export function normalizeComposition(comp: KinoComposition): NormalizedComposition {
  const norm = normalizeCompositionFull(comp);
  return norm;
}

/** Selects a single scene by id, rebasing its timeline to zero. */
export function selectScene(norm: NormalizedComposition, sceneId: string): NormalizedComposition {
  const scene = norm.scenes.find((s) => s.id === sceneId);
  if (!scene) {
    const known = norm.scenes.map((s) => s.id).join(", ");
    throw new Error(`Unknown scene '${sceneId}'. Available scenes: ${known}`);
  }

  // A scene rendered alone has no neighbours to transition from.
  const elements = scene.elements.map((elem) => ({
    ...elem,
    startTime: (elem.startTime ?? 0) - scene.startTime,
  }));
  const shifted = { ...scene, startTime: 0, elements, transition: undefined };

  return {
    ...norm,
    duration: scene.duration,
    background: scene.background,
    elements,
    scenes: [shifted],
    // Audio that starts before this scene would otherwise be dropped; clamp
    // tracks that begin inside the scene and keep their relative offset.
    audio: norm.audio
      .filter((track) => {
        const start = track.startTime ?? 0;
        return start >= scene.startTime && start < scene.startTime + scene.duration;
      })
      .map((track) => ({ ...track, startTime: (track.startTime ?? 0) - scene.startTime })),
  };
}

function normalizeCompositionFull(comp: KinoComposition): NormalizedComposition {
  const width = parsePixels(comp.width, undefined, 1920)!;
  const height = parsePixels(comp.height, undefined, 1080)!;
  const fps = parseFps(comp.fps, 30);

  const audioTracks: NormalizedAudioTrack[] = normalizeAudio(comp.audio);
  const normalizedScenes: NormalizedScene[] = [];
  const flattenedElements: NormalizedElement[] = [];

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
    // Fits are resolved before validation so the schema only ever sees a
    // normal duration, and the numeric value is not recomputed later.
    resolvedScenes.push({ ...scene, duration: resolveSceneDuration(scene.duration), elements: resolvedElems });
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
    const sceneDur = parseDuration(resolveSceneDuration(scene.duration)) ?? 0;
    const transDuration = i > 0 && scene.transition ? parseDuration(scene.transition.duration, sceneDur) ?? 0 : 0;

    if (i > 0) {
      currentOffset -= transDuration;
    }
    const sceneStart = currentOffset;
    currentOffset += sceneDur;

    // `s.say()` attaches speech to a scene; hoist it into composition audio at
    // the scene's absolute start, which is only known here.
    const narration = (scene as { narration?: unknown[] }).narration;
    if (narration?.length) {
      for (const spec of narration) {
        audioTracks.push({
          // Already a WAV path when resolveTtsTracks() ran; otherwise a spec
          // that normalizeAudio() rejects loudly.
          src: spec as NormalizedAudioTrack["src"],
          startTime: sceneStart,
          volume: 1,
          speech: true,
        });
      }
    }

    const normBg = normalizeBackground(scene.background);
    const normElems: NormalizedElement[] = [];

    for (const rawElem of scene.elements || []) {
      const elem = normalizeElement(rawElem, {
        canvasWidth: width,
        canvasHeight: height,
        sceneDuration: sceneDur,
      });
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
      transition: scene.transition
        ? {
            ...scene.transition,
            duration: transDuration,
          }
        : undefined,
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
        const sfxTrack = elem.sfx as any;
        audioTracks.push({
          src: sfxTrack.src || "",
          startTime: (parseDuration(sfxTrack.startTime) ?? elem.startTime ?? 0),
          offset: parseDuration(sfxTrack.offset),
          duration: parseDuration(sfxTrack.duration),
          volume: parseVolume(sfxTrack.volume),
          loop: sfxTrack.loop,
          fadeIn: parseDuration(sfxTrack.fadeIn),
          fadeOut: parseDuration(sfxTrack.fadeOut),
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
    // Ducking resolves last: narration and sfx tracks are only appended above,
    // and `duck: true` has to see them to know what to listen to.
    audio: resolveDucking(audioTracks, comp.audio),
    // Carried through as written; the compiler turns it into filters, and
    // validation rejects nonsense before that point.
    ...(comp.grade ? { grade: { ...comp.grade } } : {}),
  };
}
