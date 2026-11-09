import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoComposition, NormalizedHtmlElement } from "../../types/index.js";
import { normalizeComposition } from "../../normalize/composition.js";
import { isTakumiMarkup } from "../../remote/takumi.js";
import { renderTakumiBatch } from "./takumi.js";

/**
 * Render every `tak:` element in a composition to a PNG.
 *
 * Returns a map keyed by index in `norm.elements`. Identity cannot be used:
 * `compile()` normalizes independently, so it builds its own element objects.
 * The order of `norm.elements` is deterministic for the same composition.
 *
 * The caller owns the returned files: they live in a temp directory for the
 * lifetime of the render.
 */
export async function renderTakumiElements(
  composition: KinoComposition
): Promise<Map<unknown, string>> {
  const norm = normalizeComposition(composition);
  const indexed = norm.elements
    .map((el, index) => ({ el, index }))
    .filter(
      (e): e is { el: NormalizedHtmlElement; index: number } =>
        e.el.type === "html" && isTakumiMarkup((e.el as NormalizedHtmlElement).html)
    );
  if (indexed.length === 0) return new Map();

  const dir = mkdtempSync(join(tmpdir(), "kino-takumi-"));
  try {
    const paths = await renderTakumiBatch(indexed.map((e) => e.el) as never, dir);
    const out = new Map<unknown, string>();
    for (const { el, index } of indexed) {
      const path = paths.get(el);
      if (path) out.set(index, path);
    }
    return out;
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}
