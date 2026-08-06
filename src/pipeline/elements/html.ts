import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import type { HtmlElement } from "../../types/index.js";

export function renderHtmlBatchSync(
  elements: HtmlElement[],
  stagingDir: string,
  browserPath?: string
): string[] {
  if (elements.length === 0) return [];
  const inputPath = join(stagingDir, `html-input-${Date.now()}.json`);
  const moduleDir =
    typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
  // Navigate up from src/pipeline/elements/ → root → scripts/
  const helper = join(moduleDir, "../../../scripts/render-html.mjs");
  writeFileSync(inputPath, JSON.stringify(elements), "utf8");
  const result = spawnSync(
    process.execPath,
    [helper, inputPath, stagingDir, browserPath || ""],
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
