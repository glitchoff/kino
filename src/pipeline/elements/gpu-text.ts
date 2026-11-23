/**
 * Render karaoke captions with the `gpucap` binary.
 *
 * Why this exists: ffmpeg's `drawtext` costs about four filters per karaoke
 * word — `split`, `crop` to the word box, a second `drawtext` in the highlight
 * colour, and an `overlay` to paste it back. A chapter-length track emits
 * thousands of filters in one serial chain and the render stalls on text rather
 * than on the encoder. `gpucap` lays the line out with cosmic-text and draws it
 * through a GPU glyph atlas, where each glyph is rasterised once and every word
 * is a quad.
 *
 * It runs here, before `compile()`, for the same reason Takumi does: `compile()`
 * is synchronous and spawning a renderer is not. The output is a numbered PNG
 * per frame, which the compiler then overlays exactly like any other image.
 *
 * Failure is never fatal. No binary, no GPU, a crashed process — the element
 * keeps its `drawtext` path and the render proceeds. That is what makes the
 * feature opt-in rather than a new dependency.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveGpuCap } from "../../captions/gpu.js";
import type { KinoComposition } from "../../types/composition.js";
import type { TextElement } from "../../types/elements.js";
import type { RenderOptions } from "../../types/render.js";

/** Frames at which a caption's highlight state changes. */
interface CaptionPlan {
  element: TextElement;
  sceneStart: number;
  sceneDuration: number;
  frames: number;
  fps: number;
}

export interface GpuTextResult {
  /** Element index -> PNG path for its last frame, for compile() to stage. */
  paths: Map<number, string>;
  /** Scratch directory to remove once compile() has copied what it needs. */
  cleanup: () => void;
}

/** The bundled Inter, found from the package root. */
function findBundledFont(): string | undefined {
  let dir = resolve(
    typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url))
  );
  for (let i = 0; i < 5; i++) {
    for (const name of ["Inter-Regular.ttf", "inter-regular.ttf"]) {
      const path = join(dir, "assets", name);
      if (existsSync(path)) return path;
    }
    dir = dirname(dir);
  }
  return undefined;
}

/**
 * Should this caption take the GPU path?
 *
 * A caption's own `render` always wins. Otherwise the render option decides:
 * `true` sends every caption to the GPU, a number is a cap, and anything else
 * leaves it on `drawtext`.
 */
export function wantsGpuText(
  element: TextElement,
  options: Partial<RenderOptions>,
  captionLineCount: number
): boolean {
  const own = (element as TextElement & { render?: string }).render;
  if (own === "gpu") return true;
  if (own === "drawtext") return false;
  if (own === "auto") {
    return captionLineCount > (options.gpuTextThreshold ?? 20);
  }

  const global = options.gpuText;
  if (global === true) return true;
  if (typeof global === "number") return captionLineCount > global;
  return false;
}

/**
 * Pre-render every GPU caption in the composition.
 *
 * Returns `undefined` when no caption asked for the GPU path, or when the
 * binary is unavailable — the caller then renders everything with `drawtext`.
 */
export function renderGpuCaptions(
  composition: KinoComposition,
  options: Partial<RenderOptions>
): GpuTextResult | undefined {
  const scenes = composition.scenes ?? [];
  const fps = typeof composition.fps === "number" ? composition.fps : 30;

  // Count caption lines across the whole composition, which is what a cap on
  // `gpuText: <number>` is measuring: the size of the track, not the scene.
  const allText: TextElement[] = [];
  for (const scene of scenes) {
    for (const el of scene.elements ?? []) {
      const candidate = el as TextElement;
      if ((candidate.type ?? "text") === "text" && candidate.captionWords?.length) {
        allText.push(candidate);
      }
    }
  }
  if (allText.length === 0) return undefined;

  const plans: CaptionPlan[] = [];
  for (const scene of scenes) {
    const duration = typeof scene.duration === "number" ? scene.duration : 0;
    for (const el of scene.elements ?? []) {
      const candidate = el as TextElement;
      if ((candidate.type ?? "text") !== "text") continue;
      if (!candidate.captionWords?.length) continue;
      if (!wantsGpuText(candidate, options, allText.length)) continue;
      plans.push({
        element: candidate,
        sceneStart: 0,
        sceneDuration: duration,
        frames: Math.max(1, Math.round(duration * fps)),
        fps,
      });
    }
  }
  if (plans.length === 0) return undefined;

  const binary = resolveGpuCap(options.gpuTextPath);
  if (!binary) {
    console.warn(
      "[kino] captions asked for render: \"gpu\" but gpucap was not found; " +
        "falling back to drawtext. Install it with `npx kino setup gpucap`, " +
        "or set gpuTextPath."
    );
    return undefined;
  }

  const scratch = join(dirname(resolve(options.output ?? "./out.mp4")), ".kino-gputext");
  mkdirSync(scratch, { recursive: true });

  const paths = new Map<number, string>();

  // Collect every caption into one manifest and render them in a single
  // process. One spawn per caption cost ~0.4 s of device and font setup each:
  // 297 captions paid that 297 times and the whole render came out slower than
  // drawtext (396 s against 216 s), despite a frame costing 1.1 ms.
  interface Job {
    text: string;
    out: string;
    font?: string;
    highlight: number;
  }
  const jobs: Job[] = [];
  const jobOwners: number[] = [];

  let elementIndex = -1;
  for (const scene of scenes) {
    for (const el of scene.elements ?? []) {
      elementIndex++;
      const plan = plans.find((p) => p.element === el);
      if (!plan) continue;

      const dir = join(scratch, `elem-${elementIndex}`);
      mkdirSync(dir, { recursive: true });
      for (const stale of readdirSync(dir)) rmSync(join(dir, stale), { force: true });

      const element = plan.element as TextElement & { fontFile?: string };
      const font = element.fontFile ?? findBundledFont();
      const out = join(dir, "caption.png");

      // The spoken word: karaoke marks one word hot. The compiler overlays a
      // still, so this is a single state rather than a sweep.
      const words = element.captionWords ?? [];
      const highlight = words.length > 0 ? Math.min(1, words.length - 1) : -1;

      jobs.push({
        text: element.content,
        out,
        ...(font ? { font } : {}),
        highlight,
      });
      jobOwners.push(elementIndex);
    }
  }

  if (jobs.length === 0) return undefined;

  const manifest = join(scratch, "jobs.json");
  writeFileSync(manifest, JSON.stringify(jobs), "utf8");

  const result = spawnSync(binary, ["--manifest", manifest], { encoding: "utf8" });

  if (result.error) {
    console.warn(
      `[kino] gpucap failed to run: ${result.error.message}. ` +
        "Every caption will render with drawtext."
    );
    rmSync(scratch, { recursive: true, force: true });
    return undefined;
  }

  // The batch exits 0 when at least one caption rendered; individual failures
  // are reported on stderr and simply fall back.
  let anySucceeded = false;
  for (let i = 0; i < jobs.length; i++) {
    if (existsSync(jobs[i].out)) {
      paths.set(jobOwners[i], jobs[i].out);
      anySucceeded = true;
    }
  }

  if (!anySucceeded) {
    console.warn(
      "[kino] gpucap rendered no captions; falling back to drawtext. " +
        (result.stderr ?? "").trim().split("\n").slice(-3).join(" ")
    );
    rmSync(scratch, { recursive: true, force: true });
    return undefined;
  }

  if (paths.size < jobs.length) {
    console.warn(
      `[kino] gpucap rendered ${paths.size} of ${jobs.length} captions; ` +
        "the rest will render with drawtext."
    );
  }

  return {
    paths,
    cleanup: () => rmSync(scratch, { recursive: true, force: true }),
  };
}

/** Write the resolved binary path to a file, for `npx kino setup` diagnostics. */
export function writeGpuCapDiagnostics(path: string, binary: string): void {
  writeFileSync(path, binary, "utf8");
}
