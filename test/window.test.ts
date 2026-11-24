import { describe, test, expect } from "vitest";
import { windowComposition, sceneSpans, compositionDuration } from "../src/pipeline/window.js";
import type { KinoComposition } from "../src/types/index.js";

/** Ten 10-second scenes, so every boundary is a round number. */
function tenScenes(): KinoComposition {
  return {
    width: 720,
    height: 1280,
    fps: 30,
    scenes: Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}`,
      duration: 10,
      background: "#000000",
    })),
  } as KinoComposition;
}

describe("sceneSpans", () => {
  test("reports cumulative start and end for every scene", () => {
    const spans = sceneSpans(tenScenes());
    expect(spans).toHaveLength(10);
    expect(spans[0]).toEqual({ index: 0, start: 0, end: 10 });
    expect(spans[3]).toEqual({ index: 3, start: 30, end: 40 });
    expect(compositionDuration(tenScenes())).toBe(100);
  });
});

describe("windowComposition", () => {
  test("keeps whole scenes when the window starts on a boundary", () => {
    const { composition, start, duration, sceneCount } = windowComposition(tenScenes(), 40, 4);
    expect(sceneCount).toBe(1);
    expect(start).toBe(40);
    expect(duration).toBe(4);
    // Trimmed at the TAIL: the scene's clock still starts at zero.
    expect(composition.scenes[0]!.duration).toBe(4);
  });

  test("spans several scenes when the window is longer than one", () => {
    const { composition, start, sceneCount } = windowComposition(tenScenes(), 30, 25);
    expect(start).toBe(30);
    expect(sceneCount).toBe(3); // 30-40, 40-50, 50-55
    expect(composition.scenes[0]!.duration).toBe(10);
    expect(composition.scenes[1]!.duration).toBe(10);
    expect(composition.scenes[2]!.duration).toBe(5);
  });

  test("snaps back to the scene start so nothing is trimmed at its head", () => {
    // 43 falls inside scene 4 (40-50). Starting there would restart that
    // scene's clock and move its captions, so the window backs up to 40.
    const { start, duration } = windowComposition(tenScenes(), 43, 4);
    expect(start).toBe(40);
    expect(duration).toBe(4);
  });

  test("returns the composition unchanged when the window covers everything", () => {
    const comp = tenScenes();
    const result = windowComposition(comp, 0, Infinity);
    expect(result.composition).toBe(comp);
    expect(result.duration).toBe(100);
  });

  test("returns the composition unchanged for a window longer than the clip", () => {
    const comp = tenScenes();
    expect(windowComposition(comp, 0, 500).composition).toBe(comp);
  });

  test("clamps a start past the end instead of returning no scenes", () => {
    const { sceneCount, duration } = windowComposition(tenScenes(), 999, 4);
    expect(sceneCount).toBeGreaterThan(0);
    expect(duration).toBeGreaterThan(0);
  });

  test("never trims a scene at its head, whatever the start", () => {
    for (const at of [0, 5, 13, 27, 55, 99]) {
      const { composition, start } = windowComposition(tenScenes(), at, 4);
      const spans = sceneSpans(composition);
      // The first kept scene begins at the window's own zero, and it is a whole
      // scene's worth of content unless the tail was cut.
      expect(start % 10).toBe(0);
      expect(spans[0]!.start).toBe(0);
    }
  });
});
