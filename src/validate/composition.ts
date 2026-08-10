import { KinoValidationError, type ValidationIssue } from "./error.js";
import { isFlexiblePositiveNumber, isNonEmptyString, isObject } from "./helpers.js";
import { validateScenes } from "./scene.js";

function validateTemplates(
  templates: unknown,
  templateIds: Set<string>,
  issues: ValidationIssue[]
): void {
  if (!Array.isArray(templates)) {
    issues.push({ path: "templates", message: "Expected an array of templates" });
    return;
  }
  templates.forEach((tmpl: unknown, tIdx: number) => {
    const tmplPath = `templates[${tIdx}]`;
    if (!isObject(tmpl)) {
      issues.push({ path: tmplPath, message: `Expected a template object, received ${typeof tmpl}` });
      return;
    }
    if (!isNonEmptyString(tmpl.id)) {
      issues.push({ path: `${tmplPath}.id`, message: "Expected a non-empty string template id" });
    } else if (templateIds.has(tmpl.id)) {
      issues.push({ path: `${tmplPath}.id`, message: `Duplicate template id "${tmpl.id}"` });
    } else {
      templateIds.add(tmpl.id);
    }
    const validTypes = ["text", "image", "html", "video"];
    if (tmpl.type !== undefined && (typeof tmpl.type !== "string" || !validTypes.includes(tmpl.type))) {
      issues.push({ path: `${tmplPath}.type`, message: `Expected one of ${validTypes.map((t) => JSON.stringify(t)).join(", ")}, received ${JSON.stringify(tmpl.type)}` });
    }
    if (isObject(tmpl.props)) {
      const props = tmpl.props as Record<string, unknown>;
      if (props.animation !== undefined && !isObject(props.animation)) {
        issues.push({ path: `${tmplPath}.props.animation`, message: "Expected an animation object" });
      }
    }
  });
}

export function validateComposition(comp: unknown): void {
  const issues: ValidationIssue[] = [];

  if (!isObject(comp)) {
    throw new KinoValidationError([{
      path: "composition",
      message: `Expected a KinoComposition object, received ${comp === null ? "null" : Array.isArray(comp) ? "array" : typeof comp}`,
    }]);
  }

  if (comp.width !== undefined && !isFlexiblePositiveNumber(comp.width)) {
    issues.push({ path: "width", message: `Expected a positive integer or valid dimension (e.g. 1920, "1920px"), received ${comp.width}` });
  }
  if (comp.height !== undefined && !isFlexiblePositiveNumber(comp.height)) {
    issues.push({ path: "height", message: `Expected a positive integer or valid dimension (e.g. 1080, "1080px"), received ${comp.height}` });
  }
  if (comp.fps !== undefined && !isFlexiblePositiveNumber(comp.fps)) {
    issues.push({ path: "fps", message: `Expected a positive number or frame rate (e.g. 30, "30fps"), received ${comp.fps}` });
  }

  if (!Array.isArray(comp.scenes) || comp.scenes.length === 0) {
    issues.push({ path: "scenes", message: "Expected a non-empty array of scenes" });
    throw new KinoValidationError(issues);
  }

  const templateIds = new Set<string>();
  if (comp.templates !== undefined) {
    validateTemplates(comp.templates, templateIds, issues);
  }

  validateScenes(comp.scenes, templateIds, issues);

  if (issues.length > 0) {
    throw new KinoValidationError(issues);
  }
}
