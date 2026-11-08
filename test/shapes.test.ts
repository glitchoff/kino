import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { rasterRect, rasterEllipse, rasterLine } from "../src/pipeline/elements/shapes.js";
import { getFFmpegBinaryPath } from "../src/encoder/probe.js";
import { composition } from "../src/builder/index.js";
import { rect, ellipse, line } from "../src/builder/index.js";
import { compile } from "../src/pipeline/compile.js";
import { validateComposition } from "../src/validate/index.js";
import { exportComposition } from "../src/pipeline/export.js";

interface Pixels {
  width: number;
  height: number;
  data: Buffer;
}

/** Decode a PNG to RGBA. */
function pixels(path: string, width: number, height: number): Pixels {
  const data = execFileSync(
    getFFmpegBinaryPath(),
    ["-hide_banner", "-loglevel", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
    { maxBuffer: 64 * 1024 * 1024 }
  );
  return { width, height, data };
}

function at(p: Pixels, x: number, y: number): [number, number, number, number] {
  const i = (y * p.width + x) * 4;
  return [p.data[i], p.data[i + 1], p.data[i + 2], p.data[i + 3]];
}

function countOpaque(p: Pixels): number {
  let n = 0;
  for (let i = 3; i < p.data.length; i += 4) if (p.data[i] > 40) n++;
  return n;
}

describe("shape rasterisers", () => {
  // A shared directory, created once. A "cleanup" test inside the describe ran
  // in declaration order and deleted the files the other tests were reading.
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "kino-shapes-"));
  });
  afterAll(() => {
    if (!process.env.KEEP_SHAPES) rmSync(dir, { recursive: true, force: true });
    else console.log("kept:", dir);
  });
  const opts = (name: string, width: number, height: number) => ({
    out: join(dir, name),
    width,
    height,
    workDir: dir,
  });

  test("rect fills the whole box", () => {
    const o = opts("rect.png", 100, 60);
    rasterRect(o, { fill: "#ff0000" });
    expect(existsSync(o.out)).toBe(true);
    const p = pixels(o.out, 100, 60);
    expect(countOpaque(p)).toBe(100 * 60);
    expect(at(p, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(at(p, 99, 59)).toEqual([255, 0, 0, 255]);
  });

  test("rect with no fill is fully transparent", () => {
    const o = opts("empty.png", 40, 40);
    rasterRect(o, {});
    const p = pixels(o.out, 40, 40);
    expect(countOpaque(p)).toBe(0);
  });

  test("a stroke draws only a border", () => {
    const o = opts("stroke.png", 100, 100);
    rasterRect(o, { fill: "transparent", stroke: "#00ff00", strokeWidth: 4 });
    const p = pixels(o.out, 100, 100);
    // The centre is untouched, the edge is drawn.
    expect(at(p, 50, 50)[3]).toBeLessThan(40);
    expect(at(p, 1, 50)[3]).toBeGreaterThan(200);
    // A border is far fewer pixels than a fill.
    expect(countOpaque(p)).toBeLessThan(100 * 100 * 0.4);
  });

  test("a rounded rect leaves its corners clear", () => {
    const o = opts("round.png", 100, 100);
    rasterRect(o, { fill: "#0000ff", radius: 30 });
    const p = pixels(o.out, 100, 100);
    // Corners are outside the radius; the middle of an edge is not.
    expect(at(p, 1, 1)[3]).toBeLessThan(40);
    expect(at(p, 50, 1)[3]).toBeGreaterThan(200);
    expect(at(p, 50, 50)[3]).toBeGreaterThan(200);
    expect(countOpaque(p)).toBeLessThan(100 * 100);
  });

  test("ellipse fills a disc, not the box", () => {
    const o = opts("ellipse.png", 100, 100);
    rasterEllipse(o, { fill: "#00ff00" });
    const p = pixels(o.out, 100, 100);
    expect(at(p, 50, 50)).toEqual([0, 255, 0, 255]);
    // Corners fall outside the circle.
    expect(at(p, 1, 1)[3]).toBeLessThan(40);
    expect(at(p, 98, 98)[3]).toBeLessThan(40);
    // Roughly pi/4 of the box.
    const n = countOpaque(p);
    expect(n).toBeGreaterThan(100 * 100 * 0.7);
    expect(n).toBeLessThan(100 * 100 * 0.85);
  });

  test("an ellipse in a wide box is an ellipse, not a circle", () => {
    const o = opts("wide.png", 200, 100);
    rasterEllipse(o, { fill: "#ffffff" });
    const p = pixels(o.out, 200, 100);
    // (10,50) is just inside the left extreme; (100,5) sits near the top edge,
    // which is inside a 200x100 ellipse ((0)² + (0.81)² < 1) but would be
    // outside a circle of radius 100. The corners are what proves the shape.
    expect(at(p, 10, 50)[3]).toBeGreaterThan(200);
    expect(at(p, 100, 5)[3]).toBeGreaterThan(200);
    expect(at(p, 5, 5)[3]).toBeLessThan(40);
    expect(at(p, 195, 95)[3]).toBeLessThan(40);
  });

  test("line draws along its segment and nowhere else", () => {
    const o = opts("line.png", 100, 100);
    rasterLine(o, { x1: 0, y1: 0, x2: 99, y2: 99, stroke: "#0000ff", strokeWidth: 6 });
    const p = pixels(o.out, 100, 100);
    expect(at(p, 50, 50)[3]).toBeGreaterThan(200);
    expect(at(p, 90, 10)[3]).toBeLessThan(40);
    expect(at(p, 10, 90)[3]).toBeLessThan(40);
    // A diagonal band is a small fraction of the box.
    expect(countOpaque(p)).toBeLessThan(100 * 100 * 0.2);
  });

  test("a horizontal line stays horizontal", () => {
    const o = opts("hline.png", 100, 40);
    rasterLine(o, { x1: 0, y1: 20, x2: 99, y2: 20, stroke: "#ff00ff", strokeWidth: 4 });
    const p = pixels(o.out, 100, 40);
    expect(at(p, 50, 20)[3]).toBeGreaterThan(200);
    expect(at(p, 50, 2)[3]).toBeLessThan(40);
  });

  test("an invalid colour fails loudly rather than drawing nothing", () => {
    // Passing garbage through to ffmpeg is right: a silent transparent shape
    // is far worse than an error naming the colour.
    const o = opts("weird.png", 20, 20);
    expect(() => rasterRect(o, { fill: "not-a-colour" })).toThrow(/not-a-colour|Failed to rasterise/);
  });
});

describe("shapes as elements", () => {
  const comp = () =>
    composition({ width: 400, height: 300, fps: 12 })
      .scene({ duration: 1, background: "#000000" }, (s) => {
        s.add(rect({ width: 100, height: 60, x: 20, y: 20, fill: "#ff0000" }));
        s.add(ellipse({ width: 100, height: 100, x: 150, y: 20, fill: "#00ff00" }));
        s.add(line({ width: 100, height: 100, x: 280, y: 20, x1: 0, y1: 0, x2: 99, y2: 99, stroke: "#0000ff", strokeWidth: 6 }));
      })
      .build();

  test("compiles to image inputs with alpha preserved", () => {
    const { filtergraph } = compile(comp(), { dryRun: true });
    // Without format=rgba the scale drops the alpha channel and the shape
    // disappears into the background.
    expect(filtergraph).toContain("format=rgba");
    expect(filtergraph!.match(/overlay=/g)!.length).toBe(3);
  });

  test("a still is looped so it covers the whole scene", () => {
    // Without -loop the input is one frame at t=0 and `fps=` resamples it into
    // nothing, so the overlay draws no image at all.
    const { args } = compile(comp(), { dryRun: true });
    expect(args.filter((a) => a === "-loop").length).toBe(3);
  });

  test("validation rejects a shape with no fill and no stroke", () => {
    const bad = composition({ width: 100, height: 100 })
      .scene({ duration: 1 }, (s) => s.add(rect({ width: 10, height: 10 })))
      .build();
    expect(() => validateComposition(bad)).toThrow(/neither a fill nor a stroke/);
  });

  test("validation rejects a shape without a size", () => {
    const bad = composition({ width: 100, height: 100 })
      .scene({ duration: 1 }, (s) => s.add(rect({ width: 0, height: 10, fill: "#fff" })))
      .build();
    expect(() => validateComposition(bad)).toThrow();
  });
});

describe("shapes render into the frame", () => {
  test("each shape appears at its own position and colour", async () => {
    const comp = composition({ width: 400, height: 300, fps: 12 })
      .scene({ duration: 1, background: "#000000" }, (s) => {
        s.add(rect({ width: 100, height: 60, x: 20, y: 20, fill: "#ff0000" }));
        s.add(ellipse({ width: 100, height: 100, x: 150, y: 20, fill: "#00ff00" }));
        s.add(line({ width: 100, height: 100, x: 280, y: 20, x1: 0, y1: 0, x2: 99, y2: 99, stroke: "#0000ff", strokeWidth: 6 }));
      })
      .build();
    const dir = mkdtempSync(join(tmpdir(), "kino-shape-render-"));
    try {
      const { frames } = await exportComposition(comp, { frames: [0.3], frameDir: dir });
      const d = execFileSync(
        getFFmpegBinaryPath(),
        ["-hide_banner", "-loglevel", "error", "-i", frames![0].path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        { maxBuffer: 64 * 1024 * 1024 }
      );
      const px = (x: number, y: number) => {
        const i = (y * 400 + x) * 3;
        return [d[i], d[i + 1], d[i + 2]];
      };
      expect(px(70, 50)[0]).toBeGreaterThan(200);   // red rect
      expect(px(70, 50)[1]).toBeLessThan(40);
      expect(px(200, 70)[1]).toBeGreaterThan(200);  // green ellipse
      expect(px(200, 70)[0]).toBeLessThan(40);
      expect(px(330, 70)[2]).toBeGreaterThan(200);  // blue line
      expect(px(390, 280)).toEqual([0, 0, 0]);      // background untouched
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
