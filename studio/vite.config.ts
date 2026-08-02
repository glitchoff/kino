import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const honoPort = process.env.HONO_PORT || process.env.PORT || 3333;

export default defineConfig({
  plugins: [react()],
  root: resolve(import.meta.dirname),
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/api": {
        target: `http://localhost:${honoPort}`,
        changeOrigin: true,
      },
      "/renders": {
        target: `http://localhost:${honoPort}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
});
