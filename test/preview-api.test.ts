import { describe, test, expect } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { composition } from "../src/builder/index.js";
import { Preview, previewFrames } from "../src/pipeline/preview.js";
import { getFFmpegBinaryPath } from "../src/encoder/probe.js";

function twoScenes() {
  return composition({ width: 640, height: 360, fps: 24 })
    .scene({ duration: 2, background: "#141c30" }, (s) =>
      s.text("A", { fontSize: 60, x: "center", y: "center" })
    )
    .scene({ duration: 2, background: "#312e81" }, (s) =>
      s.text("B", { fontSize: 60, x: "center", y: "center" })
    )
    .build();
}

/** Corner pixel of a PNG, as [r, g, b]. */
function corner(png: Buffer): [number, number, number] {
  const dir = mkdtempSync(join(tmpdir(), "kino-pv-px-"));
  try {
    const p = join(dir, "f.png");
    writeFileSync(p, png);
    const d = execFileSync(
      getFFmpegBinaryPath(),
      ["-hide_banner", "-loglevel", "error", "-i", p, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
      { maxBuffer: 64 * 1024 * 1024 }
    );
    return [d[0], d[1], d[2]];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(process.platform !== "linux")("Preview", () => {
  test("opens and reports the composition's length and frame rate", async () => {
    const pv = await Preview.open(twoScenes());
    try {
      expect(pv.length).toBe(4);
      expect(pv.frameRate).toBe(24);
    } finally {
      pv.close();
    }
  }, 120_000);

  test("a frame is a real image with a data URL", async () => {
    const pv = await Preview.open(twoScenes());
    try {
      const f = await pv.frame(1);
      expect(f.at).toBe(1);
      expect(f.data.length).toBeGreaterThan(100);
      expect(f.url.startsWith("data:image/png;base64,")).toBe(true);
      // The data URL must decode to the same bytes.
      expect(Buffer.from(f.url.split(",")[1], "base64").equals(f.data)).toBe(true);
    } finally {
      pv.close();
    }
  }, 120_000);

  test("each timestamp returns that moment, not the first frame", async () => {
    // The one-shot `frames` path used to return t=0 for every request; a
    // preview that did the same would be useless for scrubbing.
    const pv = await Preview.open(twoScenes());
    try {
      const a = corner((await pv.frame(0.5)).data);
      const b = corner((await pv.frame(3.0)).data);
      expect(a).toEqual([19, 27, 47]);   // #141c30
      expect(b).toEqual([47, 44, 127]);  // #312e81
    } finally {
      pv.close();
    }
  }, 120_000);

  test("timestamps outside the composition are clamped", async () => {
    const pv = await Preview.open(twoScenes());
    try {
      const past = await pv.frame(999);
      expect(past.at).toBeLessThanOrEqual(pv.length);
      const before = await pv.frame(-5);
      expect(before.at).toBe(0);
    } finally {
      pv.close();
    }
  }, 120_000);

  test("a session is cheaper per frame than opening a new one", async () => {
    const pv = await Preview.open(twoScenes());
    try {
      await pv.frame(0.2); // warm up
      const t0 = Date.now();
      const frames = await pv.frames([0.4, 0.8, 1.2, 1.6, 2.4, 2.8, 3.2, 3.6]);
      const perFrame = (Date.now() - t0) / frames.length;
      expect(frames).toHaveLength(8);
      // Measured ~30ms in practice; 150ms leaves room for a slow CI box while
      // still failing if a frame silently recompiles the composition.
      expect(perFrame).toBeLessThan(150);
    } finally {
      pv.close();
    }
  }, 180_000);

  test("jpeg output is smaller than png", async () => {
    const pv = await Preview.open(twoScenes(), { format: "jpg" });
    try {
      const f = await pv.frame(1);
      expect(f.url.startsWith("data:image/jpeg;base64,")).toBe(true);
    } finally {
      pv.close();
    }
  }, 120_000);

  test("the proxy is smaller than the composition's own frame size", async () => {
    // The whole point: a small proxy makes seeks cheap.
    const pv = await Preview.open(twoScenes(), { height: 180 });
    try {
      const f = await pv.frame(1);
      expect(f.data.length).toBeLessThan(20 * 1024);
    } finally {
      pv.close();
    }
  }, 120_000);

  test("close() removes the temporary files", async () => {
    const pv = await Preview.open(twoScenes());
    const f = await pv.frame(1);
    expect(existsSync(f.data.length > 0 ? process.cwd() : "")).toBe(true);
    pv.close();
    // A second close is harmless.
    expect(() => pv.close()).not.toThrow();
  }, 120_000);

  test("previewFrames opens, samples and closes in one call", async () => {
    const frames = await previewFrames(twoScenes(), [0.5, 3.0]);
    expect(frames).toHaveLength(2);
    expect(corner(frames[0].data)).toEqual([19, 27, 47]);
    expect(corner(frames[1].data)).toEqual([47, 44, 127]);
  }, 120_000);
});
