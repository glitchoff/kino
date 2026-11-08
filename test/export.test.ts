import { describe, test, expect } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportComposition } from "../src/pipeline/export.js";
import { composition } from "../src/builder/index.js";

function twoScenes() {
  return composition({ width: 320, height: 180, fps: 12 })
    .scene({ duration: 1, background: "#141c30" }, (s) =>
      s.text("A", { fontSize: 40, x: "center", y: "center" })
    )
    .scene({ duration: 1, background: "#312e81", transition: { type: "fade", duration: 0.2 } }, (s) =>
      s.text("B", { fontSize: 40, x: "center", y: "center" })
    )
    .build();
}

describe("exportComposition", () => {
  test("a single frame returns a path and inline data", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-export-test-"));
    try {
      const { frames } = await exportComposition(twoScenes(), { frames: [0.5], frameDir: dir });
      expect(frames).toHaveLength(1);
      expect(frames![0].at).toBe(0.5);
      expect(existsSync(frames![0].path)).toBe(true);
      expect(frames![0].data).toMatch(/^data:image\/png;base64,/);
      // The data URL must decode to a real PNG, not an empty string.
      expect(frames![0].data.length).toBeGreaterThan(200);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  test("frames are named from the timestamp, or from `name`", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-export-test-"));
    try {
      const { frames } = await exportComposition(twoScenes(), {
        frames: [0.5, { at: 1.5, name: "second" }],
        frameDir: dir,
      });
      expect(frames!.map((f) => f.path.split("/").pop())).toEqual([
        "frame-0_5.png",
        "second.png",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  test("asking only for frames never writes a video", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-export-test-"));
    try {
      const result = await exportComposition(twoScenes(), { frames: [0.2], frameDir: dir });
      expect(result.video).toBeUndefined();
      expect(result.preview).toBeUndefined();
      expect(result.frames).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  test("an empty request returns nothing and does not compile", async () => {
    const result = await exportComposition(twoScenes(), {});
    expect(result).toEqual({});
  });

  test("frames reject a pre-compiled .kino path", async () => {
    await expect(
      exportComposition("/tmp/whatever.kino", { frames: [1] })
    ).rejects.toThrow(/require a composition/);
  });
});
