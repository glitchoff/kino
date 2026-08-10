import { describe, test, expect } from "vitest";
import {
  parsePixels,
  parseDuration,
  parseFps,
  parseVolume,
  parseScale,
  parseLineHeight,
} from "../src/normalize/unit-parser.js";
import { validateComposition } from "../src/validate/index.js";
import { normalizeComposition } from "../src/normalize/index.js";
import { compile } from "../src/pipeline/index.js";
import type { KinoComposition } from "../src/types/index.js";

describe("Kino Flexible Units & Pythonic Agent Compatibility", () => {
  describe("Unit Parser", () => {
    test("parses pixel and point dimensions", () => {
      expect(parsePixels(100)).toBe(100);
      expect(parsePixels("100")).toBe(100);
      expect(parsePixels("100px")).toBe(100);
      expect(parsePixels("72pt")).toBe(96);
      expect(parsePixels("50%", 1080)).toBe(540);
      expect(parsePixels(undefined, 1080, 0)).toBe(0);
    });

    test("parses duration and time units", () => {
      expect(parseDuration(5)).toBe(5);
      expect(parseDuration("5")).toBe(5);
      expect(parseDuration("5s")).toBe(5);
      expect(parseDuration("5.5s")).toBe(5.5);
      expect(parseDuration("5000ms")).toBe(5);
      expect(parseDuration("50%", 10)).toBe(5);
      expect(parseDuration(undefined)).toBeUndefined();
    });

    test("parses fps, volume, scale, line height", () => {
      expect(parseFps("30fps")).toBe(30);
      expect(parseFps("60")).toBe(60);
      expect(parseVolume("80%")).toBe(0.8);
      expect(parseVolume("1.0")).toBe(1.0);
      expect(parseScale("2x")).toBe(2);
      expect(parseLineHeight("120%")).toBe(1.2);
      expect(parseLineHeight("24px", 20)).toBe(1.2);
    });
  });

  describe("Validation with Flexible Units", () => {
    test("accepts composition canvas dimensions and fps with unit strings", () => {
      const comp: any = {
        width: "1920px",
        height: "1080px",
        fps: "30fps",
        scenes: [{ duration: "5s" }],
      };
      expect(() => validateComposition(comp)).not.toThrow();
    });

    test("accepts scene and transition durations in seconds and milliseconds", () => {
      const comp: any = {
        scenes: [
          { duration: "5s" },
          { duration: "5000ms", transition: { type: "fade", duration: "1000ms" } },
        ],
      };
      expect(() => validateComposition(comp)).not.toThrow();
    });

    test("accepts element dimensions, font size, padding, volume, and timing in unit strings", () => {
      const comp: any = {
        scenes: [
          {
            duration: "10s",
            elements: [
              {
                type: "text",
                content: "Hello Units",
                fontSize: "72px",
                maxWidth: "80%",
                box: true,
                boxPadding: "20px",
                startAt: "2s",
                duration: "5000ms",
                x: "center",
                y: "top+10%",
                offsetX: "5%",
              },
              {
                type: "image",
                src: "test.png",
                width: "50%",
                height: "300px",
                x: "left+5%",
                y: "bottom-10%",
              },
              {
                type: "video",
                src: "test.mp4",
                trimStart: "1s",
                volume: "80%",
              },
            ],
          },
        ],
      };
      expect(() => validateComposition(comp)).not.toThrow();
    });

    test("accepts animation channels with unit strings", () => {
      const comp: any = {
        scenes: [
          {
            duration: "5s",
            elements: [
              {
                type: "text",
                content: "Animated Units",
                animation: {
                  opacity: { from: "0%", to: "100%", duration: "1s", delay: "500ms" },
                  x: { from: "0px", to: "100px", duration: "1s" },
                },
              },
            ],
          },
        ],
      };
      expect(() => validateComposition(comp)).not.toThrow();
    });
  });

  describe("Normalization with Flexible Units", () => {
    test("normalizes canvas dimensions, scene timing, and element dimensions", () => {
      const comp: KinoComposition = {
        width: "1920px",
        height: "1080px",
        fps: "60fps",
        scenes: [
          {
            duration: "10s",
            elements: [
              {
                type: "text",
                content: "Title",
                fontSize: "72pt", // 72pt = 96px
                maxWidth: "50%", // 50% of 1920 = 960px
                startAt: "2s",
                duration: "50%", // 50% of 10s = 5s
              },
              {
                type: "image",
                src: "test.png",
                width: "50%", // 960px
                height: "50%", // 540px
              },
            ],
          },
        ],
      };
      const norm = normalizeComposition(comp);
      expect(norm.width).toBe(1920);
      expect(norm.height).toBe(1080);
      expect(norm.fps).toBe(60);
      expect(norm.scenes[0].duration).toBe(10);

      const textElem = norm.scenes[0].elements[0] as any;
      expect(textElem.fontSize).toBe(96);
      expect(textElem.maxWidth).toBe(960);
      expect(textElem.startAt).toBe(2);
      expect(textElem.duration).toBe(5);

      const imgElem = norm.scenes[0].elements[1] as any;
      expect(imgElem.width).toBe(960);
      expect(imgElem.height).toBe(540);
    });

    test("normalizes audio track timing and volume units", () => {
      const comp: KinoComposition = {
        audio: [
          {
            src: "bg.mp3",
            startTime: "1s",
            duration: "5000ms",
            volume: "80%",
            fadeIn: "500ms",
          },
        ],
        scenes: [{ duration: "10s" }],
      };
      const norm = normalizeComposition(comp);
      expect(norm.audio[0].startTime).toBe(1);
      expect(norm.audio[0].duration).toBe(5);
      expect(norm.audio[0].volume).toBe(0.8);
      expect(norm.audio[0].fadeIn).toBe(0.5);
    });
  });

  describe("FFmpeg Compiler & Position Expression Formatting", () => {
    test("compiles percentage positions and unit shorthands into valid filtergraph expressions", () => {
      const comp: KinoComposition = {
        width: 1920,
        height: 1080,
        scenes: [
          {
            duration: 5,
            elements: [
              {
                type: "text",
                content: "Top Text",
                x: "center",
                y: "top+10%",
              },
              {
                type: "image",
                src: "test.png",
                x: "left+5%",
                y: "bottom-10%",
              },
            ],
          },
        ],
      };
      const result = compile(comp, { output: "test-out.mp4" });
      expect(result.filtergraph).toContain("(0)+((h*(10/100)))");
      expect(result.filtergraph).toContain("(0)+((main_w*(5/100)))");
      expect(result.filtergraph).toContain("main_h-overlay_h)+((main_h*(-10/100)))");
    });
  });
});
