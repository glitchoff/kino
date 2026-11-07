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

    test("parses clock times as mm:ss and hh:mm:ss", () => {
      expect(parseDuration("0:32")).toBe(32);
      expect(parseDuration("1:02")).toBe(62);
      expect(parseDuration("2:43.5")).toBe(163.5);
      expect(parseDuration("1:00:05")).toBe(3605);
      // Surrounding whitespace is tolerated, as with the other unit forms.
      expect(parseDuration(" 0:45 ")).toBe(45);
      // Minutes may exceed 59 when they are the leading component.
      expect(parseDuration("90:00")).toBe(5400);
    });

    test("rejects malformed clock times", () => {
      // A typo in a timestamp should be surfaced, not silently parsed.
      expect(() => parseDuration("1:xx")).toThrow(/not a number/);
      expect(() => parseDuration("1:2:3:4")).toThrow(/expected mm:ss/);
      expect(() => parseDuration("1:75")).toThrow(/below 60/);
      expect(() => parseDuration("1.5:30")).toThrow(/whole number/);
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

    test("a video trimmed with trimEnd plays from trimStart for the trimmed span", () => {
      const comp: KinoComposition = {
        scenes: [
          {
            duration: 10,
            elements: [{ type: "video", src: "clip.mp4", trimStart: "0:32", trimEnd: "0:45" }],
          },
        ],
      };
      const vid = normalizeComposition(comp).scenes[0].elements[0] as any;
      expect(vid.trimStart).toBe(32);
      expect(vid.trimEnd).toBe(45);
      // "0:32".."0:45" is 13s, which is what an author expects to see.
      expect(vid.duration).toBe(13);
    });

    test("an explicit duration wins over trimEnd", () => {
      const comp: KinoComposition = {
        scenes: [
          {
            duration: 10,
            elements: [{ type: "video", src: "clip.mp4", trimStart: 2, trimEnd: 45, duration: 4 }],
          },
        ],
      };
      const vid = normalizeComposition(comp).scenes[0].elements[0] as any;
      expect(vid.duration).toBe(4);
    });

    test("rejects a trimEnd that does not come after trimStart", () => {
      const comp: KinoComposition = {
        scenes: [
          {
            duration: 10,
            elements: [{ type: "video", src: "clip.mp4", trimStart: "0:30", trimEnd: "0:20" }],
          },
        ],
      };
      expect(() => normalizeComposition(comp)).toThrow(/trimEnd .* must be greater than trimStart/);
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
