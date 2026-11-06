import { describe, test, expect } from "vitest";
import { compile } from "../src/pipeline/index.js";
import { normalizeChromaKey, buildChromaKeyFilter, buildMediaScaleFilter } from "../src/pipeline/elements/media.js";
import { composition, image, video } from "../src/builder/index.js";

function comp(elements: (s: any) => void) {
  return composition({ width: 1280, height: 720, fps: 30 })
    .scene({ duration: 3, background: "#000000" }, (s) => elements(s))
    .build();
}

describe("chroma key", () => {
  test("normalizeChromaKey defaults to green with tight similarity", () => {
    expect(normalizeChromaKey(undefined)).toBeUndefined();
    expect(normalizeChromaKey(false)).toBeUndefined();
    expect(normalizeChromaKey(true)).toEqual({
      color: "#00ff00",
      similarity: 0.01,
      blend: 0,
      despill: false,
    });
  });

  test("normalizeChromaKey clamps and accepts string numbers", () => {
    const key = normalizeChromaKey({ color: "#0000ff", similarity: "0.4", blend: 2, despill: true });
    expect(key).toEqual({ color: "#0000ff", similarity: 0.4, blend: 1, despill: true });
    expect(normalizeChromaKey({ similarity: -1 })!.similarity).toBe(0);
  });

  test("buildChromaKeyFilter emits an ffmpeg chromakey filter", () => {
    const filter = buildChromaKeyFilter({ color: "#00ff00", similarity: 0.2, blend: 0.1, despill: false });
    expect(filter).toBe("chromakey=color=0x00ff00:similarity=0.2:blend=0.1");
  });

  test("despill follows the key colour", () => {
    const green = buildChromaKeyFilter({ color: "green", similarity: 0.1, blend: 0, despill: true });
    expect(green).toContain("despill=type=green");
    const blue = buildChromaKeyFilter({ color: "#0000ff", similarity: 0.1, blend: 0, despill: true });
    expect(blue).toContain("despill=type=blue");
  });

  test("keyed layers stay RGBA in the scale filter", () => {
    expect(buildMediaScaleFilter({ width: 640, chromaKey: { color: "#0f0" } })).toBe("scale=640:-1,format=rgba");
    expect(buildMediaScaleFilter({ width: 640 })).toBe("scale=640:-1");
    expect(buildMediaScaleFilter({ width: 640, height: 360, fit: "cover", chromaKey: true })).toBe(
      "scale=640:360:force_original_aspect_ratio=increase,crop=640:360,format=rgba"
    );
  });

  test("image chromaKey reaches the filtergraph", () => {
    const { filtergraph } = compile(
      comp((s) => s.image("./green-screen.png", { width: 640, chromaKey: { color: "#00ff00", similarity: 0.15 } })),
      { output: "key.mp4" }
    );
    expect(filtergraph).toContain("chromakey=color=0x00ff00:similarity=0.15");
    expect(filtergraph).toContain("format=rgba");
  });

  test("video chromaKey keeps RGBA instead of forcing yuv420p", () => {
    const { filtergraph } = compile(
      comp((s) => s.video("./green-screen.mp4", { width: 640, chromaKey: true })),
      { output: "key.mp4" }
    );
    expect(filtergraph).toContain("chromakey=color=0x00ff00");
    // The keyed video stage must not convert to yuv420p, or the alpha is lost.
    const keyedStage = filtergraph!
      .split(";")
      .find((stage) => stage.includes("chromakey"))!;
    expect(keyedStage).not.toContain("format=yuv420p");
    expect(keyedStage).toContain("format=rgba");
  });

  test("layers without chromaKey are unaffected", () => {
    const { filtergraph } = compile(
      comp((s) => s.image("./plain.png", { width: 640 })),
      { output: "plain.mp4" }
    );
    expect(filtergraph).not.toContain("chromakey");
  });

  test("builder passes chromaKey through to the element", () => {
    const img = image("./a.png", { chromaKey: true });
    expect(img.chromaKey).toBe(true);
    const vid = video("./a.mp4", { chromaKey: { color: "#0000ff" } });
    expect(vid.chromaKey).toEqual({ color: "#0000ff" });
    // Not set stays absent so JSON stays clean.
    expect("chromaKey" in image("./a.png")).toBe(false);
  });
});
