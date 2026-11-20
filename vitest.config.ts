import { defineConfig } from "vitest/config";

/**
 * `test-dist/` is deliberately excluded: those suites import the built bundle
 * and need `pnpm exec tsup` first, so they run under `vitest.dist.config.ts`
 * via `pnpm test:dist`. Without the exclusion the main suite picks them up,
 * finds a stale or missing `dist/`, and fails for the wrong reason.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "test-dist/**"],
    // Encoder choice must not depend on the host GPU. Without this the probe
    // returns `h264_nvenc` on a machine with a card and `libx264` elsewhere, so
    // any assertion on encoder flags passes on one machine and fails on the
    // next. Tests that care pass `encoder` explicitly; the rest get x264.
    env: { KINO_ENCODER: "libx264" },
  },
});
