import { readFileSync } from "node:fs";
import { describe, test, expect } from "vitest";
import { validateComposition, KinoValidationError } from "../src/validate/index.js";
import { normalizeComposition } from "../src/normalize/index.js";
import { compile } from "../src/pipeline/index.js";
import type { KinoComposition, TextElement, ImageElement, VideoElement } from "../src/types/index.js";

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

    test("validates offsetX is a finite number", () => {
      const comp: any = {
        scenes: [
          {
            duration: 5,
            elements: [
              {
                type: "text",
                content: "Hello",
                offsetX: "invalid",
              },
            ],
          },
        ],
      };
      expect(() => validateComposition(comp)).toThrow(KinoValidationError);
    });

    test("validates offsetY is a finite number", () => {
      const comp: any = {
        scenes: [
          {
            duration: 5,
            elements: [
              {
                type: "text",
                content: "Hello",
                offsetY: Infinity,
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

    test("normalizes offsetX/offsetY properties on elements", () => {
      const comp: KinoComposition = {
        scenes: [
          {
            duration: 3,
            elements: [
              {
                type: "text",
                content: "Offset",
                x: "center",
                y: "center",
                offsetX: -50,
                offsetY: 100,
              },
            ],
          },
        ],
      };
      const norm = normalizeComposition(comp);
      const elem = norm.scenes[0].elements[0];
      expect(elem.offsetX).toBe(-50);
      expect(elem.offsetY).toBe(100);
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

    test("applies offsetX/offsetY to text element positioning in drawtext filter", () => {
      const comp: KinoComposition = {
        scenes: [
          {
            duration: 3,
            elements: [
              {
                type: "text",
                content: "Hello",
                x: "center",
                y: "center",
                offsetX: -90,
                offsetY: 120,
              },
            ],
          },
        ],
      };
      const result = compile(comp, { output: "test-out.mp4" });
      expect(result.filtergraph).toContain("(w-text_w)/2)+(-90");
      expect(result.filtergraph).toContain("(h-text_h)/2)+(120)");
    });

    test("applies offsetX/offsetY to media element positioning in overlay filter", () => {
      const comp: KinoComposition = {
        scenes: [
          {
            duration: 3,
            elements: [
              {
                type: "image",
                src: "test.png",
                x: "center",
                y: "center",
                offsetX: 50,
                offsetY: -30,
              },
            ],
          },
        ],
      };
      const result = compile(comp, { output: "test-out.mp4" });
      expect(result.filtergraph).toContain("(main_w-overlay_w)/2)+(50)");
      expect(result.filtergraph).toContain("(main_h-overlay_h)/2)+(-30)");
    });

    test("works without offsetX/offsetY (backward compatible)", () => {
      const comp: KinoComposition = {
        scenes: [
          {
            duration: 3,
            elements: [
              {
                type: "text",
                content: "Centered",
                x: "center",
                y: "center",
              },
            ],
          },
        ],
      };
      const result = compile(comp, { output: "test-out.mp4" });
      expect(result.filtergraph).toContain("(w-text_w)/2");
      expect(result.filtergraph).toContain("(h-text_h)/2");
    });

    test("resolves 'left' named position to 0 for text x", () => {
      const comp: KinoComposition = {
        scenes: [
          {
            duration: 3,
            elements: [
              {
                type: "text",
                content: "Left",
                x: "left",
                y: "center",
              },
            ],
          },
        ],
      };
      const result = compile(comp, { output: "test-out.mp4" });
      expect(result.filtergraph).toContain("x=0");
    });

    test("resolves 'right' named position to w-text_w for text x", () => {
      const comp: KinoComposition = {
        scenes: [
          {
            duration: 3,
            elements: [
              {
                type: "text",
                content: "Right",
                x: "right",
                y: "center",
              },
            ],
          },
        ],
      };
      const result = compile(comp, { output: "test-out.mp4" });
      expect(result.filtergraph).toContain("x=w-text_w");
    });

    test("resolves 'top' named position to 0 for text y", () => {
      const comp: KinoComposition = {
        scenes: [
          {
            duration: 3,
            elements: [
              {
                type: "text",
                content: "Top",
                x: "center",
                y: "top",
              },
            ],
          },
        ],
      };
      const result = compile(comp, { output: "test-out.mp4" });
      expect(result.filtergraph).toContain("y=0");
    });

    test("resolves 'bottom' named position to h-text_h for text y", () => {
      const comp: KinoComposition = {
        scenes: [
          {
            duration: 3,
            elements: [
              {
                type: "text",
                content: "Bottom",
                x: "center",
                y: "bottom",
              },
            ],
          },
        ],
      };
      const result = compile(comp, { output: "test-out.mp4" });
      expect(result.filtergraph).toContain("y=h-text_h");
    });

    test("resolves 'left' named position to 0 for media x", () => {
      const comp: KinoComposition = {
        scenes: [
          {
            duration: 3,
            elements: [
              {
                type: "image",
                src: "test.png",
                x: "left",
                y: "center",
              },
            ],
          },
        ],
      };
      const result = compile(comp, { output: "test-out.mp4" });
      expect(result.filtergraph).toContain("x=0");
    });

    test("resolves 'right' named position to main_w-overlay_w for media x", () => {
      const comp: KinoComposition = {
        scenes: [
          {
            duration: 3,
            elements: [
              {
                type: "image",
                src: "test.png",
                x: "right",
                y: "center",
              },
            ],
          },
        ],
      };
      const result = compile(comp, { output: "test-out.mp4" });
      expect(result.filtergraph).toContain("x=main_w-overlay_w");
    });

    test("resolves 'bottom' named position to main_h-overlay_h for media y", () => {
      const comp: KinoComposition = {
        scenes: [
          {
            duration: 3,
            elements: [
              {
                type: "image",
                src: "test.png",
                x: "center",
                y: "bottom",
              },
            ],
          },
        ],
      };
      const result = compile(comp, { output: "test-out.mp4" });
      expect(result.filtergraph).toContain("y=main_h-overlay_h");
    });

    test("combines named position with offsetX/offsetY", () => {
      const comp: KinoComposition = {
        scenes: [
          {
            duration: 3,
            elements: [
              {
                type: "text",
                content: "Offset Left",
                x: "left",
                y: "center",
                offsetX: 20,
                offsetY: -50,
              },
            ],
          },
        ],
      };
      const result = compile(comp, { output: "test-out.mp4" });
      expect(result.filtergraph).toContain("x=(0)+(20)");
      expect(result.filtergraph).toContain("y=((h-text_h)/2)+(-50)");
    });

    test("resolves shorthand 'center-90' to center + offsetX=-90", () => {
      const comp: KinoComposition = {
        scenes: [
          {
            duration: 3,
            elements: [
              {
                type: "text",
                content: "Shorthand",
                x: "center-90",
                y: "center",
              },
            ],
          },
        ],
      };
      const result = compile(comp, { output: "test-out.mp4" });
      expect(result.filtergraph).toContain("(w-text_w)/2)+(-90)");
    });

    test("resolves shorthand 'right+50' to right + offsetX=50", () => {
      const comp: KinoComposition = {
        scenes: [
          {
            duration: 3,
            elements: [
              {
                type: "text",
                content: "Right Shorthand",
                x: "right+50",
                y: "center",
              },
            ],
          },
        ],
      };
      const result = compile(comp, { output: "test-out.mp4" });
      expect(result.filtergraph).toContain("x=(w-text_w)+(50)");
    });

    test("resolves shorthand 'bottom-20' to bottom + offsetY=-20", () => {
      const comp: KinoComposition = {
        scenes: [
          {
            duration: 3,
            elements: [
              {
                type: "text",
                content: "Bottom Shorthand",
                x: "center",
                y: "bottom-20",
              },
            ],
          },
        ],
      };
      const result = compile(comp, { output: "test-out.mp4" });
      expect(result.filtergraph).toContain("y=h-text_h-20");
    });

    test("resolves media shorthand 'center+120' to center + offsetY=120", () => {
      const comp: KinoComposition = {
        scenes: [
          {
            duration: 3,
            elements: [
              {
                type: "image",
                src: "test.png",
                x: "center",
                y: "center+120",
              },
            ],
          },
        ],
      };
      const result = compile(comp, { output: "test-out.mp4" });
      expect(result.filtergraph).toContain("y=((main_h-overlay_h)/2)+(120)");
    });

    test("rejects shorthand + explicit offsetX as ambiguous", () => {
      const comp: any = {
        scenes: [
          {
            duration: 3,
            elements: [
              {
                type: "text",
                content: "Ambiguous",
                x: "center-90",
                offsetX: 20,
              },
            ],
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
              path: expect.stringContaining(".x"),
              message: expect.stringContaining("Ambiguous position"),
            }),
          ])
        );
      }
    });

    test("rejects shorthand + explicit offsetY as ambiguous", () => {
      const comp: any = {
        scenes: [
          {
            duration: 3,
            elements: [
              {
                type: "text",
                content: "Ambiguous",
                y: "bottom-20",
                offsetY: 10,
              },
            ],
          },
        ],
      };
      expect(() => validateComposition(comp)).toThrow(KinoValidationError);
    });
  });

  describe("Templates", () => {
    test("resolves template props and merges with element props", () => {
      const comp: KinoComposition = {
        templates: [
          {
            id: "hero",
            type: "text",
            props: {
              fontSize: 120,
              fontColor: "#ffffff",
              x: "center",
            },
          },
        ],
        scenes: [
          {
            duration: 3,
            elements: [
              {
                template: "hero",
                type: "text",
                content: "KINO",
                offsetY: -50,
              },
            ],
          },
        ],
      };
      const norm = normalizeComposition(comp);
      const elem = norm.scenes[0].elements[0] as TextElement;
      expect(elem.fontSize).toBe(120);
      expect(elem.fontColor).toBe("#ffffff");
      expect(elem.x).toBe("center");
      expect(elem.offsetY).toBe(-50);
      expect(elem.content).toBe("KINO");
    });

    test("element props override template props", () => {
      const comp: KinoComposition = {
        templates: [
          {
            id: "hero",
            type: "text",
            props: {
              fontSize: 120,
              fontColor: "#ffffff",
            },
          },
        ],
        scenes: [
          {
            duration: 3,
            elements: [
              {
                template: "hero",
                type: "text",
                content: "KINO",
                fontColor: "#ff0000",
              },
            ],
          },
        ],
      };
      const norm = normalizeComposition(comp);
      const elem = norm.scenes[0].elements[0] as TextElement;
      expect(elem.fontColor).toBe("#ff0000");
      expect(elem.fontSize).toBe(120);
    });

    test("deep merges animation channels from template", () => {
      const comp: KinoComposition = {
        templates: [
          {
            id: "hero",
            type: "text",
            props: {
              fontSize: 120,
              x: "center",
              animation: {
                opacity: { from: 0, to: 1, duration: 0.5 },
                scale: { from: 0.8, to: 1, duration: 0.6 },
              },
            },
          },
        ],
        scenes: [
          {
            duration: 3,
            elements: [
              {
                template: "hero",
                type: "text",
                content: "KINO",
                 animation: { opacity: { from: 0, to: 1, duration: 1 } },
                },
              ],
            },
          ],
      };
      const norm = normalizeComposition(comp);
      const elem = norm.scenes[0].elements[0] as TextElement;
      expect(elem.animation?.opacity?.duration).toBe(1);
      expect(elem.animation?.scale?.from).toBe(0.8);
    });

    test("strips template field from resolved element", () => {
      const comp: KinoComposition = {
        templates: [
          {
            id: "hero",
            type: "text",
            props: {
              fontSize: 120,
              x: "center",
            },
          },
        ],
        scenes: [
          {
            duration: 3,
            elements: [
              {
                template: "hero",
                type: "text",
                content: "KINO",
              },
            ],
          },
        ],
      };
      const norm = normalizeComposition(comp);
      const elem = norm.scenes[0].elements[0];
      expect((elem as any).template).toBeUndefined();
    });

    test("throws on unknown template reference", () => {
      const comp: KinoComposition = {
        scenes: [
          {
            duration: 3,
            elements: [
              {
                template: "nonexistent",
                type: "text",
                content: "KINO",
              },
            ],
          },
        ],
      };
      expect(() => normalizeComposition(comp)).toThrow(
        'Unknown template reference: "nonexistent"'
      );
    });

    test("throws when template type mismatches element type", () => {
      const comp: KinoComposition = {
        templates: [
          {
            id: "hero",
            type: "text",
            props: {
              fontSize: 120,
            },
          },
        ],
        scenes: [
          {
            duration: 3,
            elements: [
              {
                template: "hero",
                type: "image",
                src: "test.png",
              },
            ],
          },
        ],
      };
      expect(() => normalizeComposition(comp)).toThrow(
        'Template "hero" is type "text" but element type is "image"'
      );
    });

    test("throws when element using template omits type", () => {
      const comp: any = {
        templates: [
          {
            id: "hero",
            type: "text",
            props: {
              fontSize: 120,
            },
          },
        ],
        scenes: [
          {
            duration: 3,
            elements: [
              {
                template: "hero",
                content: "KINO",
              },
            ],
          },
        ],
      };
      expect(() => validateComposition(comp)).toThrow(KinoValidationError);
    });

    test("rejects duplicate template ids", () => {
      const comp: any = {
        templates: [
          { id: "hero", type: "text", props: { fontSize: 120 } },
          { id: "hero", type: "text", props: { fontSize: 48 } },
        ],
        scenes: [{ duration: 3 }],
      };
      expect(() => validateComposition(comp)).toThrow(KinoValidationError);
    });

    test("rejects reference to undefined template id", () => {
      const comp: any = {
        templates: [{ id: "hero", type: "text", props: { fontSize: 120 } }],
        scenes: [
          {
            duration: 3,
            elements: [
              {
                template: "missing",
                type: "text",
                content: "KINO",
              },
            ],
          },
        ],
      };
      expect(() => validateComposition(comp)).toThrow(KinoValidationError);
    });

    test("compiles composition with templates to filtergraph", () => {
      const comp: KinoComposition = {
        templates: [
          {
            id: "hero",
            type: "text",
            props: {
              fontSize: 120,
              fontColor: "#ffffff",
              x: "center",
            },
          },
        ],
        scenes: [
          {
            duration: 3,
            background: "#0f172a",
            elements: [
              {
                template: "hero",
                type: "text",
                content: "KINO",
                y: "center",
              },
            ],
          },
        ],
      };
      const result = compile(comp, { output: "test-out.mp4" });
      expect(result.filtergraph).toContain("fontsize=120");
      expect(result.filtergraph).toContain("fontcolor=#ffffff");
      expect(result.filtergraph).toContain("x=(w-text_w)/2");
    });
  });
});



