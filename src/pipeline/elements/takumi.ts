import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { HtmlElement } from "../../types/index.js";
import { TAKUMI_MISSING_HINT, isTakumiMarkup, takumiMarkup } from "../../remote/takumi.js";

/**
 * Render `tak:` markup with Takumi — no browser.
 *
 * Takumi is loaded lazily so a composition that never writes `tak:` does not pay
 * for the native binding.
 */

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

interface TakumiModule {
  render: (
    input: unknown,
    options: {
      width: number;
      height: number;
      format?: string;
      devicePixelRatio?: number;
      fonts?: { name: string; data: ArrayBuffer | Uint8Array; weight?: number; style?: string }[];
    }
  ) => Promise<Uint8Array>;
}

let takumiModule: TakumiModule | undefined;

async function loadTakumi(): Promise<TakumiModule> {
  if (takumiModule) return takumiModule;
  try {
    // A variable specifier keeps bundlers from trying to resolve an optional
    // dependency at build time.
    const specifier = "takumi-js";
    takumiModule = (await import(specifier)) as unknown as TakumiModule;
    return takumiModule;
  } catch {
    throw new Error(TAKUMI_MISSING_HINT);
  }
}

/** Render every `tak:` element to a PNG, in order. */
export async function renderTakumiBatch(
  elements: HtmlElement[],
  stagingDir: string
): Promise<Map<HtmlElement, string>> {
  const out = new Map<HtmlElement, string>();
  const targets = elements.filter((el) => isTakumiMarkup(el.html));
  if (targets.length === 0) return out;

  const takumi = await loadTakumi();
  const fontPath = findBundledFont();
  const fontData = fontPath
    ? new Uint8Array((await import("node:fs")).readFileSync(fontPath))
    : undefined;

  for (let i = 0; i < targets.length; i++) {
    const el = targets[i];
    const png = await takumi.render(takumiMarkup(el.html), {
      width: Math.max(1, Math.round(Number(el.width))),
      height: Math.max(1, Math.round(Number(el.height))),
      format: "png",
      // Takumi never reads system fonts; without this every glyph is tofu.
      ...(fontData
        ? { fonts: [{ name: "Inter", data: fontData, weight: 400, style: "normal" }] }
        : {}),
      ...(el.deviceScaleFactor !== undefined
        ? { devicePixelRatio: Number(el.deviceScaleFactor) || 1 }
        : {}),
    });
    const path = join(stagingDir, `takumi-${i}.png`);
    writeFileSync(path, png);
    out.set(el, path);
  }
  return out;
}
