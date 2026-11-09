import { describe, test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { composition } from "../src/builder/index.js";
import { exportComposition } from "../src/pipeline/export.js";
import { keyframeExpression, easingExpression } from "../src/animation/expressions.js";
import { validateComposition, KinoValidationError } from "../src/validate/index.js";
import { getFFmpegBinaryPath } from "../src/encoder/probe.js";
import type { Easing } from "../src/types/animation.js";

/** Leftmost lit column of a PNG, or -1. */
function inkLeft(png: string): number {
  const buf = execFileSync(
    getFFmpegBinaryPath(),
    ["-hide_banner", "-loglevel", "error", "-i", png, "-f", "rawvideo", "-pix_fmt", "gray", "-"],
    { maxBuffer: 64 * 1024 * 1024 }
  );
  const W = 400;
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < 180; y++) if (buf[y * W + x] > 40) return x;
  }
  return -1;
}

/** A single glyph sliding right, sampled at the given times. */
async function slide(animation: unknown, times: number[]): Promise<number[]> {
  const comp = composition({ width: 400, height: 180, fps: 20 })
    .scene({ duration: 2, background: "#000000" }, (s) => {
      s.text("I", { fontSize: 40, x: 0, y: 70, animation: { x: animation } as never });
    })
    .build();
  const dir = mkdtempSync(join(tmpdir(), "kino-kf-"));
  try {
    const { frames } = await exportComposition(comp, { frames: times, frameDir: dir });
    return frames!.map((f) => inkLeft(f.path));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("keyframe expressions", () => {
  test("two keyframes interpolate linearly", () => {
    const expr = keyframeExpression(
      { keyframes: [{ at: 0, value: 0 }, { at: 2, value: 100 }], easing: "linear" },
      0,
      "t"
    );
    expect(expr).toContain("min(max((t - 0)/2");
    expect(expr).toContain("(0 + (100 - 0)");
  });

  test("a later segment is nested inside the earlier one", () => {
    const expr = keyframeExpression(
      {
        keyframes: [
          { at: 0, value: 0 },
          { at: 1, value: 100 },
          { at: 2, value: 100 },
        ],
        easing: "linear",
      },
      0,
      "t"
    );
    // The hold from 1s must be the fallback of the first segment.
    expect(expr.indexOf("lt(t,1)")).toBeGreaterThan(-1);
    expect(expr.indexOf("lt(t,2)")).toBeGreaterThan(expr.indexOf("lt(t,1)"));
  });

  test("keyframe times are offset by the element's start", () => {
    const expr = keyframeExpression(
      { keyframes: [{ at: 0, value: 0 }, { at: 1, value: 10 }], easing: "linear" },
      5,
      "t"
    );
    // Element starts at 5s, so the segment ends at 6s.
    expect(expr).toContain("lt(t,6)");
  });

  test("a single keyframe is a constant", () => {
    expect(keyframeExpression({ keyframes: [{ at: 0, value: 42 }] }, 0, "t")).toBe("42");
  });

  test("keyframes are sorted by time", () => {
    const expr = keyframeExpression(
      {
        keyframes: [
          { at: 2, value: 20 },
          { at: 0, value: 0 },
        ],
        easing: "linear",
      },
      0,
      "t"
    );
    expect(expr).toContain("lt(t,2)");
    expect(expr.indexOf("(0 + (20 - 0)")).toBeGreaterThan(-1);
  });
});

describe("easing expressions", () => {
  const easings: Easing[] = [
    "linear", "easeIn", "easeOut", "easeInOut",
    "easeInSine", "easeOutSine", "easeInOutSine",
    "easeInExpo", "easeOutExpo", "easeInOutExpo",
    "easeInCirc", "easeOutCirc", "easeInOutCirc",
    "easeInBack", "easeOutBack", "easeInOutBack",
    "easeOutElastic", "easeOutBounce",
  ];

  test("every easing produces an expression", () => {
    for (const e of easings) {
      const expr = easingExpression(e, "p");
      expect(expr.length).toBeGreaterThan(0);
      expect(expr).not.toContain("undefined");
    }
  });

  test("an unknown easing falls back to linear", () => {
    expect(easingExpression("nope" as Easing, "p")).toBe("(p)");
  });
});

describe.skipIf(process.platform !== "linux")("keyframed animation — rendered", () => {
  test("a keyframe list moves and then holds", async () => {
    const xs = await slide(
      {
        keyframes: [
          { at: 0, value: 0 },
          { at: 1, value: 200 },
          { at: 2, value: 200, easing: "linear" },
        ],
        easing: "linear",
      },
      [0, 0.5, 1, 1.5, 2]
    );
    // 0 → 200 over the first second, held after.
    expect(xs[0]).toBeLessThan(20);
    expect(xs[1]).toBeGreaterThan(80);
    expect(xs[1]).toBeLessThan(130);
    expect(xs[2]).toBeGreaterThan(180);
    expect(Math.abs(xs[3] - xs[2])).toBeLessThan(3);
    expect(Math.abs(xs[4] - xs[2])).toBeLessThan(3);
  }, 120_000);

  test("the from/to form still works", async () => {
    const xs = await slide({ from: 0, to: 200, duration: 2, easing: "linear" }, [0, 1, 2]);
    expect(xs[0]).toBeLessThan(20);
    expect(xs[1]).toBeGreaterThan(80);
    expect(xs[2]).toBeGreaterThan(180);
  }, 120_000);

  test("easeOutBack overshoots its target", async () => {
    const xs = await slide({ from: 0, to: 100, duration: 1, easing: "easeOutBack" }, [0.6]);
    // Overshoot is the whole point: it must pass the end value before settling.
    expect(xs[0]).toBeGreaterThan(104);
  }, 120_000);

  test("easeOutBounce rises in steps rather than smoothly", async () => {
    const xs = await slide({ from: 0, to: 100, duration: 1, easing: "easeOutBounce" }, [0.25, 0.5]);
    // A bounce is ahead of linear early and close to the target by halfway.
    expect(xs[0]).toBeGreaterThan(40);
    expect(xs[1]).toBeGreaterThan(70);
  }, 120_000);

  test("stills match the video at the same timestamp", async () => {
    // `-ss` used to be an input option, and the lavfi background cannot be
    // seeked: every still came back as t=0, so animations looked frozen.
    const xs = await slide({ from: 0, to: 200, duration: 2, easing: "linear" }, [0, 0.5, 1, 1.5, 2]);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    }
  }, 120_000);
});

describe("keyframe validation", () => {
  const withAnim = (animation: unknown) =>
    composition({ width: 320, height: 180, fps: 12 })
      .scene({ duration: 2 }, (s) => {
        s.text("x", { fontSize: 20, animation } as never);
      })
      .build();

  test("accepts a valid keyframe list", () => {
    expect(() =>
      validateComposition(
        withAnim({ x: { keyframes: [{ at: 0, value: 0 }, { at: 1, value: 100, easing: "easeOutBack" }] } })
      )
    ).not.toThrow();
  });

  test("rejects an empty keyframe list", () => {
    expect(() => validateComposition(withAnim({ x: { keyframes: [] } }))).toThrow(KinoValidationError);
  });

  test("rejects a negative keyframe time", () => {
    expect(() =>
      validateComposition(withAnim({ x: { keyframes: [{ at: -1, value: 0 }] } }))
    ).toThrow(/non-negative/);
  });

  test("rejects an unknown easing on a keyframe", () => {
    expect(() =>
      validateComposition(
        withAnim({ x: { keyframes: [{ at: 0, value: 0, easing: "wobble" }] } })
      )
    ).toThrow(/Expected one of/);
  });

  test("rejects an opacity keyframe outside 0..1", () => {
    expect(() =>
      validateComposition(withAnim({ opacity: { keyframes: [{ at: 0, value: 2 }] } }))
    ).toThrow(/between 0 and 1/);
  });

  test("still accepts the from/to form", () => {
    expect(() =>
      validateComposition(withAnim({ x: { from: 0, to: 100, duration: 1 } }))
    ).not.toThrow();
  });
});
