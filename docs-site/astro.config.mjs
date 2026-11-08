import { defineConfig } from "astro/config";
import { visit } from "unist-util-visit";
import { remarkPreviewDirective } from "./src/plugins/preview-directive.mjs";

const BASE = "/kino";

/**
 * Rewrites markdown links to sibling `.md` files into site routes.
 *
 * The docs are written for readers browsing the repo, so they link
 * `./api-reference.md`. On the site that file is `/kino/api-reference/`, and
 * without this the links 404.
 */
function remarkDocsLinks() {
  return (tree) => {
    visit(tree, "link", (node) => {
      const match = /^\.\/([\w-]+)\.md(#.*)?$/.exec(node.url);
      // Absolute, not relative: a relative `api-reference/` inside
      // `/kino/getting-started/` resolves to `/kino/getting-started/api-reference/`.
      if (match) node.url = `${BASE}/${match[1]}/${match[2] ?? ""}`;
    });
  };
}

// The docs live in ../docs as plain markdown and are read in place, so there is
// one source of truth: the same files a reader finds in the repo.
export default defineConfig({
  site: "https://glitchoff.github.io",
  base: BASE,
  outDir: "./dist",
  build: { format: "directory" },
  markdown: {
    remarkPlugins: [remarkDocsLinks, remarkPreviewDirective],
  },
});
