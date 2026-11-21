import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  esbuildPlugins: [
    {
      // Keep `node:sqlite` exactly as written.
      //
      // `external: ["node:sqlite"]` is not enough: esbuild strips the `node:`
      // prefix and emits `from "sqlite"`, which is not a package and fails at
      // load with ERR_MODULE_NOT_FOUND. `node:sqlite` is a Node built-in, so it
      // must reach the output with its scheme intact.
      name: "keep-node-protocol",
      setup(build) {
        build.onResolve({ filter: /^node:sqlite$/ }, (args) => ({
          path: args.path,
          external: true,
        }));
      },
    },
  ],
});
