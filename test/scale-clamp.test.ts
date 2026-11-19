import { describe, test, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composition, rect } from "../src/builder/index.js";
import { compile } from "../src/pipeline/compile.js";
import { validateComposition } from "../src/validate/index.js";

/**
 * Animated scale on a wide, thin element used to emit `scale=w='…':h=-2`.
 * The derived height rounds to zero — a 1100x3 rule at scale 0.01 asks ffmpeg
 * for an 11x0 frame, which it rejects with "Picture size 11x0 is invalid".
 * The graph must clamp both dimensions to at least 2px instead.
 */
describe("animated scale never produces a zero-size frame", () => {
  test("both scale dimensions are clamped to >= 2px", async () => {
    const comp = composition({ width: 320, height: 180, fps: 24 })
      .scene({ duration: 1, background: "#101010" }, (s) => {
        s.add(
          rect({
            width: 300,
            height: 3,
            x: 10,
            y: 88,
            fill: "#3ad6c5",
            animation: { scale: { from: 0, to: 1, duration: 0.5 } },
          })
        );
      })
      .build();

    validateComposition(comp);
    const result = compile(comp, { output: join(tmpdir(), "scale-clamp-out.mp4") });
    const graph = result.args.join(" ");

    const scaleFilter = graph.match(/scale=w='[^']*':h='[^']*':eval=frame/);
    expect(scaleFilter, "expected a scale filter with explicit w and h expressions").toBeTruthy();
    expect(scaleFilter![0]).toContain("max(2,iw*");
    expect(scaleFilter![0]).toContain("max(2,ih*");
    expect(graph).not.toMatch(/scale=[^'"]*h=-2/);
  });
});
