import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  root: resolve(import.meta.dirname),
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3333",
        changeOrigin: true,
      },
      "/renders": {
        target: "http://localhost:3333",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
});
