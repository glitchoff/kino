import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  banner: ({ format }) => {
    return {};
  },
  onSuccess: async () => {
    // Post build actions if needed
  },
});
