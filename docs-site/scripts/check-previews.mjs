/**
 * Fails when a `:::preview` in the docs has no clip behind it.
 *
 * A missing clip renders as an empty black box, which nobody notices until a
 * reader does. Run from CI before the build.
 *
 *   node docs-site/scripts/check-previews.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { previewNamesIn } from "../src/plugins/preview-directive.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = join(here, "..", "..", "docs");
const previewsDir = join(here, "..", "public", "previews");

const available = new Set(
  readdirSync(previewsDir)
    .filter((f) => f.endsWith(".mp4"))
    .map((f) => f.slice(0, -4))
);

const missing = [];
let used = 0;
for (const file of readdirSync(docsDir).filter((f) => f.endsWith(".md"))) {
  const names = previewNamesIn(readFileSync(join(docsDir, file), "utf8"));
  for (const name of names) {
    used++;
    if (!available.has(name)) missing.push(`${file}: ${name}`);
  }
}

if (missing.length > 0) {
  console.error(`Missing preview clips:\n  ${missing.join("\n  ")}`);
  process.exit(1);
}
console.log(`${used} preview reference(s) across the docs, all present (${available.size} clips built).`);
