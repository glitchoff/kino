import { readFileSync } from "node:fs";
import { describe, test, expect } from "vitest";
import { validateComposition, KinoValidationError } from "../src/validate.js";
import { normalizeComposition } from "../src/normalize.js";
import { compile } from "../src/render.js";
import type { KinoComposition } from "../src/types.js";

describe("Kino Timeline Simplification + Scene Transitions", () => {
  describe("Validation", () => {
    test("validates basic composition without timeline property", () => {
      const comp: KinoComposition = {
        width: 1920,
        height: 1080,
        fps: 30,
        scenes: [{ duration: 5, background: "#000000" }],
      };
      expect(() => validateComposition(comp)).not.toThrow();
    });

    test("fails if first scene defines a transition", () => {
      const comp: any = {
        scenes: [
          {
            duration: 5,
            transition: { type: "fade", duration: 1 },
          },
        ],
      };
      expect(() => validateComposition(comp)).toThrow(KinoValidationError);
      try {
        validateComposition(comp);
      } catch (err: any) {
        expect(err.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: "scenes[0].transition",
              message: "First scene cannot define a transition",
            }),
          ])
        );
      }
    });

    test("fails if transition duration exceeds adjacent scene durations", () => {
      const comp: KinoComposition = {
        scenes: [
          { duration: 2 },
          {
            duration: 5,
            transition: { type: "slideLeft", duration: 3 },
          },
        ],
      };
      expect(() => validateComposition(comp)).toThrow(KinoValidationError);
      try {
        validateComposition(comp);
      } catch (err: any) {
        expect(err.issues[0].message).toContain("must not exceed adjacent scene durations");
      }
    });

    test("fails on invalid transition type", () => {
      const comp: any = {
        scenes: [
          { duration: 5 },
          {
            duration: 5,
            transition: { type: "invalidType", duration: 1 },
          },
        ],
      };
      expect(() => validateComposition(comp)).toThrow(KinoValidationError);
    });

    test("validates element startAt non-negative requirement", () => {
      const comp: any = {
        scenes: [
          {
            duration: 5,
            elements: [
              {
                type: "text",
                content: "Hello",
                startAt: -1,
              },
            ],
          },
        ],
      };
      expect(() => validateComposition(comp)).toThrow(KinoValidationError);
    });
  });

  describe("Normalization & Timing Calculation", () => {
    test("calculates sequential scene starts and total duration without transitions", () => {
      const comp: KinoComposition = {
        scenes: [
          { duration: 5, background: "#111111" },
          { duration: 4, background: "#222222" },
        ],
      };
      const norm = normalizeComposition(comp);
      expect(norm.scenes[0].startTime).toBe(0);
      expect(norm.scenes[1].startTime).toBe(5);
      expect(norm.duration).toBe(9);
    });

    test("calculates sequential scene starts and total duration with transition overlap", () => {
      const comp: KinoComposition = {
        scenes: [
          { duration: 5, background: "#111111" },
          {
            duration: 5,
            background: "#222222",
            transition: { type: "slideLeft", duration: 1 },
          },
        ],
      };
      const norm = normalizeComposition(comp);
      expect(norm.scenes[0].startTime).toBe(0);
      expect(norm.scenes[1].startTime).toBe(4); // 5 - 1 = 4
      expect(norm.duration).toBe(9); // 5 + 5 - 1 = 9
    });

    test("calculates chained scene transition overlaps correctly", () => {
      const comp: KinoComposition = {
        scenes: [
          { duration: 5 }, // start: 0, dur: 5
          { duration: 5, transition: { type: "fade", duration: 1 } }, // start: 4, dur: 5
          { duration: 6, transition: { type: "wipeRight", duration: 2 } }, // start: 4 + 5 - 2 = 7, dur: 6
        ],
      };
      const norm = normalizeComposition(comp);
      expect(norm.scenes[0].startTime).toBe(0);
      expect(norm.scenes[1].startTime).toBe(4);
      expect(norm.scenes[2].startTime).toBe(7);
      expect(norm.duration).toBe(13); // 7 + 6 = 13
    });

    test("defaults element startAt to 0 and omitted duration to remaining scene lifetime", () => {
      const comp: KinoComposition = {
        scenes: [
          {
            duration: 10,
            elements: [
              { type: "text", content: "Default timing" },
              { type: "text", content: "Explicit startAt", startAt: 3 },
            ],
          },
        ],
      };
      const norm = normalizeComposition(comp);
      const elem0 = norm.scenes[0].elements[0];
      const elem1 = norm.scenes[0].elements[1];

      expect(elem0.startAt).toBe(0);
      expect(elem0.duration).toBe(10);
      expect(elem0.startTime).toBe(0);

      expect(elem1.startAt).toBe(3);
      expect(elem1.duration).toBe(7); // 10 - 3 = 7
      expect(elem1.startTime).toBe(3);
    });

    test("normalizes element timing inside transitioned scenes", () => {
      const comp: KinoComposition = {
        scenes: [
          { duration: 5 },
          {
            duration: 5,
            transition: { type: "slideUp", duration: 1 },
            elements: [
              { type: "text", content: "In Scene 2", startAt: 1, duration: 3, sfx: "./click.mp3" },
            ],
          },
        ],
      };
      const norm = normalizeComposition(comp);
      // Scene 2 starts at 4s
      expect(norm.scenes[1].startTime).toBe(4);
      const elem = norm.scenes[1].elements[0];
      expect(elem.startAt).toBe(1);
      expect(elem.startTime).toBe(5); // 4 + 1 = 5
      // SFX track absolute start time should be 5s
      expect(norm.audio[0].startTime).toBe(5);
    });
  });

  describe("FFmpeg Compiler & Filtergraph Generation", () => {
    test("compiles filtergraph with xfade filter for scene transitions", () => {
      const comp: KinoComposition = {
        scenes: [
          { duration: 5, background: "#000000" },
          {
            duration: 5,
            background: "#ffffff",
            transition: { type: "slideLeft", duration: 1 },
          },
        ],
      };
      const result = compile(comp, { output: "test-out.mp4" });
      expect(result.filtergraph).toContain("xfade=transition=slideleft:duration=1:offset=4");
    });

    test("supports all Kino transition types in filtergraph", () => {
      const types = [
        "fade",
        "slideLeft",
        "slideRight",
        "slideUp",
        "slideDown",
        "wipeLeft",
        "wipeRight",
        "wipeUp",
        "wipeDown",
        "zoomIn",
        "zoomOut",
      ] as const;

      for (const t of types) {
        const comp: KinoComposition = {
          scenes: [
            { duration: 4 },
            { duration: 4, transition: { type: t, duration: 1 } },
          ],
        };
        const result = compile(comp, { output: "test-out.mp4" });
        expect(result.filtergraph).toContain("xfade=transition=");
      }
    });

    test("compiles 11 transitions in 1 single video composition", () => {
      const allTransComp: KinoComposition = JSON.parse(
        readFileSync("./examples/all-transitions.json", "utf-8")
      );
      const result = compile(allTransComp, { output: "all-transitions-out.mp4" });
      expect(result.filtergraph).toContain("xfade=transition=fade");
      expect(result.filtergraph).toContain("xfade=transition=slideleft");
      expect(result.filtergraph).toContain("xfade=transition=slideright");
      expect(result.filtergraph).toContain("xfade=transition=slideup");
      expect(result.filtergraph).toContain("xfade=transition=slidedown");
      expect(result.filtergraph).toContain("xfade=transition=wipeleft");
      expect(result.filtergraph).toContain("xfade=transition=wiperight");
      expect(result.filtergraph).toContain("xfade=transition=wipeup");
      expect(result.filtergraph).toContain("xfade=transition=wipedown");
      expect(result.filtergraph).toContain("xfade=transition=zoomin");
    });
  });
});
