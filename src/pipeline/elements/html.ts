import { existsSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import type { HtmlElement } from "../../types/index.js";

/**
 * Locates `scripts/render-html.mjs` from wherever this module ended up.
 *
 * Unbundled it sits at `src/pipeline/elements/`, three levels below the root;
 * in the tsup bundle `__dirname` is `dist/`, one level below. Assuming either
 * depth breaks the other, so walk up until the file is found.
 */
function findRenderHelper(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "scripts", "render-html.mjs");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error(
    `Cannot find scripts/render-html.mjs relative to ${startDir}. ` +
      `HTML elements need it; it ships with the package.`
  );
}

export function renderHtmlBatchSync(
  elements: HtmlElement[],
  stagingDir: string,
  browserPath?: string,
  browser?: string,
  browserUrl?: string
): string[] {
  if (elements.length === 0) return [];
  const inputPath = join(stagingDir, `html-input-${Date.now()}.json`);
  const moduleDir =
    typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
  const helper = findRenderHelper(moduleDir);
  writeFileSync(inputPath, JSON.stringify(elements), "utf8");
  const result = spawnSync(
    process.execPath,
    [helper, inputPath, stagingDir, browserPath || "", browser || "chrome", browserUrl || ""],
    { encoding: "utf8", timeout: 120000 }
  );
  rmSync(inputPath, { force: true });
  if (result.status !== 0) {
    throw new Error(
      `Failed to render html element: ${(result.stderr || "").trim() || `exit code ${result.status}`}`
    );
  }
  return JSON.parse(result.stdout) as string[];
}
