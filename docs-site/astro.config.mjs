import { defineConfig } from "astro/config";

// The docs live in ../docs as plain markdown and are copied in at build time,
// so there is one source of truth: the same files a reader finds in the repo.
export default defineConfig({
  site: "https://glitchoff.github.io",
  base: "/kino",
  outDir: "./dist",
  build: { format: "directory" },
});
