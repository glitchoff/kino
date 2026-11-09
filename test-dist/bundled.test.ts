/**
 * Runs against the built bundle, not `src/`.
 *
 * Every other suite imports from `src/`, so `__dirname` is always the source
 * layout and the `dist/` layout is never exercised. Four bugs shipped that the
 * suite could not see by construction:
 *
 * - `renderHtmlBatchSync` resolved `../../../scripts/render-html.mjs` → `/scripts/…`
 * - `resolveVendoredFFmpeg` resolved `../../vendor` → `/workspaces/vendor`,
 *   silently fell back to a build with no drawtext
 * - `findRenderHelper` and the font lookup returned *relative* paths, which
 *   `spawn` resolved against the caller's cwd
 * - the default font path named `inter-regular.ttf` when it is `Inter-Regular.ttf`
 *
 * Run with `pnpm test:dist` after `pnpm exec tsup`.
 */
import { describe, test, expect } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(here, "..");
const DIST = join(PACKAGE_ROOT, "dist");

// Import the built entry point exactly as a consumer would.
const kino = await import(join(DIST, "index.js"));

describe("bundled build", () => {
  test("dist/ exists — run `pnpm exec tsup` first", () => {
    expect(existsSync(join(DIST, "index.js"))).toBe(true);
  });

  test("the vendored ffmpeg resolves to a path inside the package", async () => {
    // The bug: from dist/ this looked for /workspaces/vendor, found nothing and
    // fell back to ffmpeg-static, which has no drawtext.
    const { getFFmpegBinaryPath } = await import(join(DIST, "index.js"));
    const bin = getFFmpegBinaryPath();
    expect(isAbsolute(bin)).toBe(true);
    expect(existsSync(bin)).toBe(true);
    expect(resolve(bin).startsWith(PACKAGE_ROOT)).toBe(true);
    expect(bin).toContain("vendor");
  });

  test("the vendored ffmpeg can drawtext", () => {
    const { getFFmpegBinaryPath } = kino;
    const filters = execFileSync(getFFmpegBinaryPath(), ["-hide_banner", "-filters"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    expect(filters).toMatch(/\bdrawtext\b/);
  });

  test("the bundled font is found from the package root", () => {
    const font = kino.defaultFontFile();
    expect(font).toBeDefined();
    expect(existsSync(font!)).toBe(true);
    expect(resolve(font!).startsWith(PACKAGE_ROOT)).toBe(true);
  });

  test("measurement works with no ffmpeg on PATH", () => {
    // Font metrics are read directly, so this must not depend on a subprocess.
    const m = kino.measureText("Title", { fontSize: 64 });
    expect(m.source).toBe("font");
    expect(m.width).toBeCloseTo(128.19, 1);
  });

  test("inspect is synchronous and reports font-measured text", () => {
    const comp = kino
      .composition({ width: 640, height: 360, fps: 24 })
      .scene({ duration: 2 }, (s) => s.text("Title", { fontSize: 64, x: "center", y: "center" }))
      .build();
    const report = kino.inspect(comp);
    expect(report).not.toBeInstanceOf(Promise);
    expect(report.scenes[0].elements[0].text!.measured).toBe("font");
    expect(report.issues).toEqual([]);
  });

  test("the compiled graph uses the bundled font", () => {
    // This was silently missing: the path was wrong, defaultFontRef stayed
    // undefined, and every render used drawtext's default font.
    const comp = kino
      .composition({ width: 320, height: 180, fps: 12 })
      .scene({ duration: 1 }, (s) => s.text("x", { fontSize: 20 }))
      .build();
    const result = kino.compile(comp, { dryRun: true });
    expect(result.filtergraph).toContain("fontfile=");
  });

  test("the CJS build resolves the same paths as ESM", async () => {
    // The package ships dist/index.cjs too. tsup warns that `import.meta` is
    // empty in the CJS output; that is fine because the `__dirname` guard
    // covers it, but nothing proved it until this test.
    const cjs = (await import(join(DIST, "index.cjs"))) as typeof kino;
    expect(cjs.getFFmpegBinaryPath()).toBe(kino.getFFmpegBinaryPath());
    expect(cjs.defaultFontFile()).toBe(kino.defaultFontFile());
    expect(cjs.measureText("Title", { fontSize: 64 }).width).toBeCloseTo(128.19, 1);
  });

  test("a text composition renders a real frame", async () => {
    // The end-to-end check: if any path is wrong, this fails loudly instead of
    // producing a frame with the wrong font or no text at all.
    const comp = kino
      .composition({ width: 320, height: 180, fps: 12 })
      .scene({ duration: 1, background: "#000000" }, (s) =>
        s.text("WWWW", { fontSize: 40, x: 0, y: 60 })
      )
      .build();
    const dir = mkdtempSync(join(tmpdir(), "kino-dist-"));
    try {
      const { frames } = await kino.exportComposition(comp, { frames: [0.2], frameDir: dir });
      expect(frames).toHaveLength(1);
      expect(existsSync(frames![0].path)).toBe(true);

      const buf = execFileSync(
        kino.getFFmpegBinaryPath(),
        ["-hide_banner", "-loglevel", "error", "-i", frames![0].path, "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        { maxBuffer: 64 * 1024 * 1024 }
      );
      let lit = 0;
      let hi = -1;
      for (let x = 0; x < 320; x++) {
        for (let y = 0; y < 180; y++) {
          if (buf[y * 320 + x] > 40) {
            lit++;
            hi = x;
            break;
          }
        }
      }
      expect(lit).toBeGreaterThan(40);
      // The bundled font draws "WWWW" about 156px wide at size 40; drawtext's
      // default font is much wider, so this catches a font regression.
      expect(hi).toBeGreaterThan(120);
      expect(hi).toBeLessThan(175);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
