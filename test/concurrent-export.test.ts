import { describe, test, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composition, image, rect, text, exportComposition } from "../src/index.js";

/**
 * Concurrent exports.
 *
 * Compiled filtergraphs reference staged files by bare name (`text-1.txt`),
 * and ffmpeg resolves those through its search path, which starts at the
 * *process* cwd rather than the spawn cwd. Two exports running at once used to
 * resolve one graph's text file against the other export's staging directory
 * and fail with `Cannot read file 'text-1.txt'` — a flake seen in CI on a
 * 2-vCPU runner, where suites run in parallel.
 *
 * These run several exports side by side, each with different text, and check
 * every one produced its own frame. Serialising the cwd around each spawn is
 * what makes that hold.
 */
describe("concurrent exports", () => {
  const build = (label: string) =>
    composition({ width: 320, height: 240, fps: 12 })
      .scene({ duration: 1, background: "#000000" }, (s) =>
        s
          .add(text(label, { fontSize: 40, color: "#ffffff", x: "center", y: "center" }))
          .add(rect({ width: 40, height: 40, x: 10, y: 10, fill: "#ff0000" }))
      )
      .build();

  test("eight exports at once each render their own text", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-concurrent-"));
    try {
      const labels = ["one", "two", "three", "four", "five", "six", "seven", "eight"];

      const results = await Promise.all(
        labels.map((label, i) =>
          exportComposition(build(label), { frames: [0.3], frameDir: join(dir, `out-${i}`) })
        )
      );

      for (const result of results) {
        expect(result.frames).toHaveLength(1);
      }
      // Each export must show its *own* text. Comparing the stills to one
      // another catches the failure the cwd race caused, where a render read
      // another render's staged text file and drew the wrong words.
      const contents = results.map((r) => readFileSync(r.frames![0].path));
      const distinct = new Set(contents.map((b) => b.toString("base64")));
      expect(distinct.size).toBe(labels.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);

  test("a failed export does not poison the next one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-concurrent-fail-"));
    try {
      // A frame past the end is clamped, so make ffmpeg fail instead by asking
      // for a frame of a composition with an asset that does not exist.
      const broken = composition({ width: 320, height: 240, fps: 12 })
        .scene({ duration: 1, background: "#000000" }, (s) => s.image("./missing-file.png"))
        .build();

      const failed = exportComposition(broken, { frames: [0.3], frameDir: dir }).catch(
        (err: Error) => err
      );
      const ok = exportComposition(build("after"), { frames: [0.3], frameDir: join(dir, "ok") });

      const [first, second] = await Promise.all([failed, ok]);

      expect(first).toBeInstanceOf(Error);
      expect(second.frames).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);

  /**
   * The shape CI actually failed in.
   *
   * Vitest gives each test *file* its own process, but a file can render more
   * than once and CI runs files in parallel. This mirrors that: several
   * exports in one process, each with text of its own, started together. The
   * original symptom was `Cannot read file 'text-1.txt'` — one render reading
   * another's staged file — and it hit `test/shapes.test.ts` roughly one run in
   * six.
   */
  test("exports started together do not read each other's staged text", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-interleaved-"));
    try {
      const labels = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];

      const results = await Promise.all(
        labels.map((label, i) =>
          exportComposition(build(label), {
            frames: [0.1, 0.5],
            frameDir: join(dir, `out-${i}`),
          })
        )
      );

      const stills = results.flatMap((r) => r.frames!.map((f) => readFileSync(f.path)));
      // Two frames per export, and within an export both frames are identical
      // (static text), so the only way to get fewer than `labels.length`
      // distinct images is for two exports to have drawn the same words.
      expect(new Set(stills.map((b) => b.toString("base64"))).size).toBe(labels.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
