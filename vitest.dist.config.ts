import { defineConfig } from "vitest/config";

/**
 * Tests that run against the built bundle rather than `src/`.
 *
 * Kept in a separate config so the main suite does not have to build first.
 * Run with `pnpm test:dist`, which builds and then runs this.
 */
export default defineConfig({
  test: {
    include: ["test-dist/**/*.test.ts"],
    // The bundle has to exist; `pnpm test:dist` builds it.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
