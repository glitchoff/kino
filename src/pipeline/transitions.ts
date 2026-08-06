import type { KinoTransitionType } from "../types/index.js";
import type { NormalizedScene } from "../types/index.js";

export function mapTransitionType(type: KinoTransitionType | string): string {
  switch (type) {
    case "fade":       return "fade";
    case "slideLeft":  return "slideleft";
    case "slideRight": return "slideright";
    case "slideUp":    return "slideup";
    case "slideDown":  return "slidedown";
    case "wipeLeft":   return "wipeleft";
    case "wipeRight":  return "wiperight";
    case "wipeUp":     return "wipeup";
    case "wipeDown":   return "wipedown";
    case "zoomIn":     return "zoomin";
    case "zoomOut":    return "rectcrop";
    default:           return "fade";
  }
}

export function buildTransitionPipeline(
  filterComplex: string[],
  scenes: NormalizedScene[],
  sceneCompPads: string[],
  fps: number
): string {
  if (scenes.length === 1) {
    return sceneCompPads[0];
  }

  const hasTransitions = scenes.some((s, idx) => idx > 0 && s.transition);

  if (!hasTransitions) {
    const concatInputs = sceneCompPads
      .map((p) => (p.startsWith("[") ? p : `[${p}]`))
      .join("");
    const outPad = "[bg_concat]";
    filterComplex.push(`${concatInputs}concat=n=${scenes.length}:v=1:a=0${outPad}`);
    return outPad;
  }

  let currentTransPad = sceneCompPads[0].startsWith("[") ? sceneCompPads[0] : `[${sceneCompPads[0]}]`;
  for (let i = 1; i < scenes.length; i++) {
    const scene = scenes[i];
    const nextScenePad = sceneCompPads[i].startsWith("[") ? sceneCompPads[i] : `[${sceneCompPads[i]}]`;
    const outPad = `[v_trans_${i}]`;
    const offset = scene.startTime;

    if (scene.transition) {
      const xfadeType = mapTransitionType(scene.transition.type);
      const dur = scene.transition.duration;
      filterComplex.push(
        `${currentTransPad}${nextScenePad}xfade=transition=${xfadeType}:duration=${dur}:offset=${offset}${outPad}`
      );
    } else {
      const minFrameDur = (1 / fps).toFixed(4);
      filterComplex.push(
        `${currentTransPad}${nextScenePad}xfade=transition=fade:duration=${minFrameDur}:offset=${offset}${outPad}`
      );
    }
    currentTransPad = outPad;
  }

  return currentTransPad;
}
