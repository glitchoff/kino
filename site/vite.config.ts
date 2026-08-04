import { defineConfig } from "vite";

// Static assets site built into ./dist, which wrangler.jsonc serves via
// Cloudflare Workers static assets.
export default defineConfig({
  root: ".",
  base: "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: { port: 5173 },
});
