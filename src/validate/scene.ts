import type { ValidationIssue } from "./error.js";
import { isFiniteNumber, isNonEmptyString, isObject } from "./helpers.js";
import { validateElement } from "./element.js";

const VALID_TRANSITION_TYPES = [
  "fade", "slideLeft", "slideRight", "slideUp", "slideDown",
  "wipeLeft", "wipeRight", "wipeUp", "wipeDown", "zoomIn", "zoomOut",
] as const;

function validateBackground(
  bg: unknown,
  bgPath: string,
  issues: ValidationIssue[]
): void {
  if (typeof bg === "string") {
    if (!isNonEmptyString(bg)) {
      issues.push({ path: bgPath, message: "Expected a non-empty color string" });
    }
    return;
  }
  if (!isObject(bg)) {
    issues.push({ path: bgPath, message: "Expected a string or background object" });
    return;
  }
  if (bg.type === "color") {
    if (!isNonEmptyString(bg.value)) {
      issues.push({ path: `${bgPath}.value`, message: "Expected a non-empty color string" });
    }
  } else if (bg.type === "gradient") {
    if (!isNonEmptyString(bg.from)) {
      issues.push({ path: `${bgPath}.from`, message: "Expected a non-empty color string" });
    }
    if (!isNonEmptyString(bg.to)) {
      issues.push({ path: `${bgPath}.to`, message: "Expected a non-empty color string" });
    }
    if (bg.direction !== undefined && bg.direction !== "horizontal" && bg.direction !== "vertical") {
      issues.push({ path: `${bgPath}.direction`, message: `Expected "horizontal" or "vertical", received ${JSON.stringify(bg.direction)}` });
    }
  } else if (bg.type === "image" || bg.type === "video") {
    if (!isNonEmptyString(bg.src)) {
      issues.push({ path: `${bgPath}.src`, message: `Expected a non-empty file path or URL for ${bg.type} background` });
    }
  } else {
    issues.push({ path: `${bgPath}.type`, message: `Expected "color", "gradient", "image", or "video", received ${JSON.stringify(bg.type)}` });
  }
}

export function validateScenes(
  scenes: unknown[],
  templateIds: Set<string>,
  issues: ValidationIssue[]
): void {
  scenes.forEach((scene: unknown, sIdx: number) => {
    const scenePath = `scenes[${sIdx}]`;

    if (!isObject(scene)) {
      issues.push({ path: scenePath, message: `Expected a scene object, received ${typeof scene}` });
      return;
    }

    if (!isFiniteNumber(scene.duration) || (scene.duration as number) <= 0) {
      issues.push({ path: `${scenePath}.duration`, message: `Expected a positive number, received ${scene.duration}` });
    }

    // Transition
    if (scene.transition !== undefined) {
      const transPath = `${scenePath}.transition`;
      if (sIdx === 0) {
        issues.push({ path: transPath, message: "First scene cannot define a transition" });
      } else if (!isObject(scene.transition)) {
        issues.push({ path: transPath, message: `Expected a transition object, received ${typeof scene.transition}` });
      } else {
        const trans = scene.transition;
        if (!isNonEmptyString(trans.type) || !VALID_TRANSITION_TYPES.includes(trans.type as any)) {
          issues.push({ path: `${transPath}.type`, message: `Expected one of ${VALID_TRANSITION_TYPES.map((t) => JSON.stringify(t)).join(", ")}, received ${JSON.stringify(trans.type)}` });
        }
        if (!isFiniteNumber(trans.duration) || (trans.duration as number) <= 0) {
          issues.push({ path: `${transPath}.duration`, message: `Expected a positive number, received ${trans.duration}` });
        } else {
          const scenesArr = scenes as any[];
          const prevScene = scenesArr[sIdx - 1];
          const prevDur = isObject(prevScene) && isFiniteNumber(prevScene.duration) ? (prevScene.duration as number) : 0;
          const currDur = isFiniteNumber(scene.duration) ? (scene.duration as number) : 0;
          if ((trans.duration as number) > prevDur || (trans.duration as number) > currDur) {
            issues.push({ path: `${transPath}.duration`, message: `Transition duration (${trans.duration}s) must not exceed adjacent scene durations (prev: ${prevDur}s, curr: ${currDur}s)` });
          }
        }
      }
    }

    // Background
    if (scene.background !== undefined) {
      validateBackground(scene.background, `${scenePath}.background`, issues);
    }

    // Elements
    if (scene.elements !== undefined) {
      if (!Array.isArray(scene.elements)) {
        issues.push({ path: `${scenePath}.elements`, message: "Expected an array of elements" });
      } else {
        scene.elements.forEach((elem: unknown, eIdx: number) => {
          validateElement(elem, `${scenePath}.elements[${eIdx}]`, templateIds, issues);
        });
      }
    }
  });
}
