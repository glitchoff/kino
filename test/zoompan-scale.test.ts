import { describe, expect, it } from "vitest";
import { applyMediaOverlay, zoompanExpression } from "../src/pipeline/elements/media.js";

const frame = { width: 1920, height: 1080, fps: 30 };
/** A slow push, the shape a manga panel gets. */
const push = { scale: { from: 1.0, to: 1.05, duration: 6, easing: "linear" } };

function build(
  elem: Record<string, unknown>,
  opts: { needsAlpha?: boolean; frame?: typeof frame | null } = {}
) {
  const fc: string[] = [];
  applyMediaOverlay(
    fc,
    "1",
    "[img_base_1]",
    { startAt: 0, duration: 6, animation: push, ...elem },
    { scale: "(1 + (1.05 - 1)*((min(max((t - 0)/6, 0), 1))))" },
    true,
    6,
    "[bg_scene_0]",
    // `null` means "no frame supplied" — distinct from omitted, which would
    // hide a test bug behind the same fallback.
    opts.frame === null ? undefined : (opts.frame ?? frame),
    opts.needsAlpha ?? false
  );
  return fc.join(";");
}

describe("zoompan scale optimisation", () => {
  it("uses zoompan for an opaque, full-frame, linear push", () => {
    const g = build({ width: 1920, height: 1080 });
    expect(g).toContain("zoompan=z='");
    expect(g).not.toContain("scale=w='max(2,iw*");
  });

  it("writes the zoom in terms of on/fps, not t", () => {
    const g = build({ width: 1920, height: 1080 });
    const zoom = g.match(/zoompan=z='([^']*)'/)?.[1] ?? "";
    expect(zoom).toContain("on/30");
    // The overlay still uses `t`; only the zoom expression is rewritten.
    expect(zoom).not.toMatch(/\bt\b/);
  });

  it("keeps scale= when the element carries alpha", () => {
    // Verified by hand: zoompan returns an opaque frame even from RGBA input.
    const g = build({ width: 1920, height: 1080 }, { needsAlpha: true });
    expect(g).toContain("scale=w='max(2,iw*");
    expect(g).not.toContain("zoompan");
  });

  it("keeps scale= when the element is smaller than the frame", () => {
    // zoompan's output is fixed at s=WxH, so a small element would be cropped.
    const g = build({ width: 640, height: 360 });
    expect(g).toContain("scale=w='max(2,iw*");
    expect(g).not.toContain("zoompan");
  });

  it("keeps scale= when no frame size was supplied", () => {
    const g = build({ width: 1920, height: 1080 }, { frame: null });
    expect(g).not.toContain("zoompan");
  });

  it("keeps scale= when the layer also animates opacity", () => {
    // Opacity runs through `geq`, which needs the alpha zoompan would flatten.
    const fc: string[] = [];
    applyMediaOverlay(
      fc,
      "1",
      "[img_base_1]",
      { startAt: 0, duration: 6, width: 1920, height: 1080, animation: push },
      { scale: "(1 + (1.05 - 1)*((min(max((t - 0)/6, 0), 1))))", opacity: "(min(max(t,0),1))" },
      true,
      6,
      "[bg_scene_0]",
      frame,
      false
    );
    expect(fc.join(";")).not.toContain("zoompan");
  });
});

describe("zoompanExpression", () => {
  it("accepts a linear ramp inside the documented 1-10 range", () => {
    expect(zoompanExpression({ from: 1, to: 1.05, duration: 6, easing: "linear" }, 30)).toContain("on/30");
  });

  it("rejects a ramp that starts below 1", () => {
    // popIn starts at 0.8; ffmpeg documents zoom's range as 1-10.
    expect(zoompanExpression({ from: 0.8, to: 1, duration: 1, easing: "linear" }, 30)).toBeUndefined();
  });

  it("rejects a ramp that exceeds 10", () => {
    expect(zoompanExpression({ from: 1, to: 12, duration: 1, easing: "linear" }, 30)).toBeUndefined();
  });

  it("rejects overshooting easings, whose endpoints do not bound the curve", () => {
    // easeOutBack passes the end value before settling.
    expect(zoompanExpression({ from: 1, to: 1.05, duration: 1, easing: "easeOutBack" }, 30)).toBeUndefined();
  });

  it("rejects keyframe tracks, which can go anywhere between points", () => {
    expect(
      zoompanExpression({ keyframes: [{ at: 0, value: 1 }, { at: 1, value: 1.2 }] }, 30)
    ).toBeUndefined();
  });

  it("rejects a missing animation", () => {
    expect(zoompanExpression(undefined, 30)).toBeUndefined();
  });
});
