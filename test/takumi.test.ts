import { describe, test, expect } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { composition, takumi, html } from "../src/builder/index.js";
import { exportComposition } from "../src/pipeline/export.js";
import { compile } from "../src/pipeline/compile.js";
import { isTakumiMarkup, takumiMarkup, TAKUMI_PREFIX } from "../src/remote/takumi.js";
import { getFFmpegBinaryPath } from "../src/encoder/probe.js";

function rgb(path: string, w: number, h: number): Buffer {
  return execFileSync(
    getFFmpegBinaryPath(),
    ["-hide_banner", "-loglevel", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 64 * 1024 * 1024 }
  );
}

describe("tak: prefix", () => {
  test("detects and strips the marker", () => {
    expect(isTakumiMarkup("tak:<div></div>")).toBe(true);
    expect(isTakumiMarkup("<div></div>")).toBe(false);
    expect(takumiMarkup("tak:<div></div>")).toBe("<div></div>");
  });

  test("takumi() is html() with the prefix", () => {
    const a = takumi("<div>x</div>", { width: 10, height: 10 });
    const b = html(TAKUMI_PREFIX + "<div>x</div>", { width: 10, height: 10 });
    expect(a).toEqual(b);
  });

  test("s.tak() produces an html element with the prefix", () => {
    const comp = composition({ width: 100, height: 100 })
      .scene({ duration: 1 }, (s) => s.tak("<div>x</div>", { width: 100, height: 100 }))
      .build();
    const el = comp.scenes[0].elements![0];
    expect(el.type).toBe("html");
    expect(isTakumiMarkup(el.html)).toBe(true);
  });

  test("tak and html coexist in one scene", () => {
    const comp = composition({ width: 100, height: 100 })
      .scene({ duration: 1 }, (s) =>
        s
          .tak("<div>a</div>", { width: 50, height: 50 })
          .html("<div>b</div>", { width: 50, height: 50 })
      )
      .build();
    const [a, b] = comp.scenes[0].elements!;
    expect(isTakumiMarkup(a.html)).toBe(true);
    expect(isTakumiMarkup(b.html)).toBe(false);
  });
});

describe("tak: rendering", () => {
  test("renders a panel and its text without a browser", async () => {
    const comp = composition({ width: 400, height: 200, fps: 12 })
      .scene({ duration: 1, background: "#000000" }, (s) => {
        s.tak(
          `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#1e293b;color:#38bdf8;font-size:48px;font-family:Inter">TAK</div>`,
          { width: 400, height: 200, x: 0, y: 0 }
        );
      })
      .build();
    const dir = mkdtempSync(join(tmpdir(), "kino-tak-"));
    try {
      const { frames } = await exportComposition(comp, { frames: [0.3], frameDir: dir });
      const d = rgb(frames![0].path, 400, 200);

      let text = 0;
      let bg = 0;
      for (let i = 0; i < d.length; i += 3) {
        if (d[i] > 40 && d[i + 1] > 150 && d[i + 2] > 200) text++;
        if (Math.abs(d[i] - 30) < 8 && Math.abs(d[i + 1] - 41) < 8 && Math.abs(d[i + 2] - 59) < 8) bg++;
      }
      // The panel covers the frame.
      expect(bg).toBeGreaterThan(100_000);
      // And the bundled font actually drew glyphs — Takumi never reads system
      // fonts, so a missing font would show tofu or nothing.
      expect(text).toBeGreaterThan(200);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  test("compile() refuses tak: markup it was not given a render for", () => {
    const comp = composition({ width: 100, height: 100 })
      .scene({ duration: 1 }, (s) => s.tak("<div>x</div>", { width: 100, height: 100 }))
      .build();
    // render() and exportComposition() run Takumi first; a bare compile() has
    // no PNG, and must say so rather than emitting an undefined src.
    expect(() => compile(comp, { dryRun: true })).toThrow(/pre-rendered PNG/);
  });

  test("a plain html element does not reach Takumi", () => {
    const comp = composition({ width: 100, height: 100 })
      .scene({ duration: 1 }, (s) => s.html("<div>x</div>", { width: 100, height: 100 }))
      .build();
    // No `tak:` prefix, so compile() takes the browser path and does not need a
    // pre-rendered PNG from Takumi.
    expect(() => compile(comp, { dryRun: true })).not.toThrow(/pre-rendered PNG/);
  });
});
