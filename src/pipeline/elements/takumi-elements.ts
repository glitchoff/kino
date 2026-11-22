import { rmSync } from "node:fs";
import { scratchDir } from "../scratch.js";
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
/**
 * Result of pre-rendering `tak:` markup.
 *
 * `cleanup()` must be called once the paths are no longer needed — after
 * `compile()` has copied them into the `.kino` artifact. They cannot be removed
 * before returning: the caller still has to read them, and deleting them in a
 * `finally` (as this used to) handed back paths to files that no longer
 * existed, which surfaced as ffmpeg's `Error opening input file … takumi-0.png`.
 */
export interface TakumiRenders {
  /** Paths, keyed by index in `norm.elements`. */
  paths: Map<unknown, string>;
  /** Removes the scratch directory holding them. */
  cleanup: () => void;
}

export async function renderTakumiElements(
  composition: KinoComposition
): Promise<TakumiRenders> {
  const noop = { paths: new Map<unknown, string>(), cleanup: () => {} };
  const norm = normalizeComposition(composition);
  const indexed = norm.elements
    .map((el, index) => ({ el, index }))
    .filter(
      (e): e is { el: NormalizedHtmlElement; index: number } =>
        e.el.type === "html" && isTakumiMarkup((e.el as NormalizedHtmlElement).html)
    );
  if (indexed.length === 0) return noop;

  const dir = scratchDir("kino-takumi-");
  let paths: Map<unknown, string>;
  try {
    paths = await renderTakumiBatch(indexed.map((e) => e.el) as never, dir);
  } catch (err) {
    // A failed render leaves nothing worth keeping, so clean up here and
    // rethrow. Success is the only case the caller owns the directory.
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }

  const out = new Map<unknown, string>();
  for (const { el, index } of indexed) {
    const path = paths.get(el);
    if (path) out.set(index, path);
  }
  return { paths: out, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
