import { describe, test, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "../src/inspect/index.js";
import { composition } from "../src/builder/index.js";

function basic() {
  return composition({ width: 640, height: 360, fps: 24 })
    .scene({ duration: 3, background: "#141c30" }, (s) => {
      s.text("Title", { fontSize: 64, x: "center", y: "center" });
    })
    .build();
}

describe("inspect", () => {
  test("reports frame size, fps and duration", () => {
    const r = inspect(basic());
    expect(r.width).toBe(640);
    expect(r.height).toBe(360);
    expect(r.fps).toBe(24);
    expect(r.duration).toBe(3);
    expect(r.scenes).toHaveLength(1);
    expect(r.issues).toEqual([]);
  });

  test("reports scene timing and transitions", () => {
    const comp = composition({ width: 320, height: 180, fps: 12 })
      .scene({ duration: 2 }, (s) => s.text("A", { fontSize: 30 }))
      .scene({ duration: 2, transition: { type: "fade", duration: 0.5 } }, (s) =>
        s.text("B", { fontSize: 30 })
      )
      .build();
    const r = inspect(comp);
    // A 0.5s transition overlaps the scenes, so the second starts at 1.5s.
    expect(r.scenes.map((s) => s.start)).toEqual([0, 1.5]);
    expect(r.scenes[1].transition).toEqual({ type: "fade", duration: 0.5 });
  });

  test("resolves a pixel position to the same box the renderer uses", () => {
    const comp = composition({ width: 640, height: 360, fps: 24 })
      .scene({ duration: 1 }, (s) => s.text("Title", { fontSize: 48, x: 40, y: 100 }))
      .build();
    const r = inspect(comp);
    const box = r.scenes[0].elements[0].box!;
    // Left-aligned drawtext places the pen exactly at x/y, verified against a
    // real render.
    expect(box.x).toBeCloseTo(40, 0);
    expect(box.y).toBeCloseTo(100, 0);
  });

  test("resolves `center` and `bottom-N` shorthands", () => {
    const comp = composition({ width: 640, height: 360, fps: 24 })
      .scene({ duration: 1 }, (s) => {
        s.text("Title", { fontSize: 48, x: "center", y: "bottom-20" });
      })
      .build();
    const r = inspect(comp);
    const box = r.scenes[0].elements[0].box!;
    expect(box.x).toBeGreaterThan(0);
    expect(box.x + box.width).toBeLessThan(640);
    // bottom-20 means 20px above the bottom edge.
    expect(box.y + box.height).toBeLessThanOrEqual(340 + 1);
    expect(box.y + box.height).toBeGreaterThan(300);
  });

  test("flags text wider than the frame", () => {
    const comp = composition({ width: 320, height: 180, fps: 24 })
      .scene({ duration: 1 }, (s) =>
        s.text("This line is far too long to fit inside a three hundred and twenty pixel frame", {
          fontSize: 48,
          x: "center",
          y: "center",
        })
      )
      .build();
    const r = inspect(comp);
    const issue = r.issues.find((i) => i.code === "text-wider-than-frame");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("error");
  });

  test("flags an element that outlives its scene", () => {
    const comp = composition({ width: 320, height: 180, fps: 24 })
      .scene({ duration: 2 }, (s) => {
        s.text("late", { fontSize: 24, startAt: 1.5, duration: 2, x: 10, y: 10 });
      })
      .build();
    const r = inspect(comp);
    expect(r.issues.map((i) => i.code)).toContain("element-outlives-scene");
  });

  test("flags a missing image source", () => {
    const comp = composition({ width: 320, height: 180, fps: 24 })
      .scene({ duration: 1 }, (s) => {
        s.image("./definitely-not-here.png", { width: 50, height: 50, x: 0, y: 0 });
      })
      .build();
    const r = inspect(comp);
    const el = r.scenes[0].elements[0];
    expect(el.src).toEqual({ path: "./definitely-not-here.png", exists: false });
    expect(r.issues.map((i) => i.code)).toContain("missing-source");
  });

  test("does not flag a source that exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-inspect-test-"));
    try {
      const img = join(dir, "pixel.png");
      writeFileSync(img, Buffer.from(""));
      const comp = composition({ width: 320, height: 180, fps: 24 })
        .scene({ duration: 1 }, (s) => {
          s.image(img, { width: 50, height: 50, x: 0, y: 0 });
        })
        .build();
      const r = inspect(comp);
      expect(r.scenes[0].elements[0].src!.exists).toBe(true);
      expect(r.issues.map((i) => i.code)).not.toContain("missing-source");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("flags overlapping elements", () => {
    const comp = composition({ width: 640, height: 360, fps: 24 })
      .scene({ duration: 1 }, (s) => {
        s.image("./a.png", { width: 100, height: 100, x: 10, y: 10 });
        s.image("./b.png", { width: 100, height: 100, x: 50, y: 50 });
      })
      .build();
    const r = inspect(comp);
    expect(r.issues.map((i) => i.code)).toContain("element-overlap");
  });

  test("reports a transition longer than its scene as an error", () => {
    const comp = composition({ width: 320, height: 180, fps: 24 })
      .scene({ duration: 3 }, (s) => s.text("A", { fontSize: 24 }))
      .scene({ duration: 1, transition: { type: "fade", duration: 2 } }, (s) =>
        s.text("B", { fontSize: 24 })
      )
      .build();
    const r = inspect(comp);
    // Validation catches this before layout, so it comes back as a schema error.
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.issues[0].severity).toBe("error");
  });

  test("reports text measured from the font, not estimated", () => {
    const r = inspect(basic());
    const el = r.scenes[0].elements[0];
    expect(el.text!.measured).toBe("font");
    expect(el.text!.widestLine).toBeGreaterThan(0);
  });

  test("the deprecated measure flag is accepted and ignored", () => {
    const a = inspect(basic());
    const b = inspect(basic(), { measure: false });
    expect(b.scenes[0].elements[0].text).toEqual(a.scenes[0].elements[0].text);
  });

  test("measuring uses each element's own font size", () => {
    // A single batch with one size silently measured everything at the default
    // 48, so a 64px title and a 24px caption came back the same width.
    const comp = composition({ width: 640, height: 360, fps: 24 })
      .scene({ duration: 1 }, (s) => {
        s.text("Title", { fontSize: 64, x: 10, y: 10 });
        s.text("Title", { fontSize: 24, x: 10, y: 200 });
      })
      .build();
    const r = inspect(comp);
    const [big, small] = r.scenes[0].elements;
    expect(big.text!.widestLine).toBeGreaterThan(small.text!.widestLine * 2);
  });

  test("accepts a builder as well as a composition", () => {
    const builder = composition({ width: 320, height: 180, fps: 24 }).scene(
      { duration: 1 },
      (s) => s.text("A", { fontSize: 24 })
    );
    const r = inspect(builder);
    expect(r.scenes).toHaveLength(1);
  });
});
