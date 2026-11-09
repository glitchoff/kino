import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

let dir: string;
const ROOT = process.cwd();

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "kino-dry-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Run the CLI's dry-run on a composition file and return stdout+stderr.
 *
 * The CLI is executed through `tsx` because compositions are TypeScript; this
 * exercises the real argument parsing and the real dry-run path rather than a
 * reimplementation of them.
 */
function dryRun(compositionSource: string, name: string) {
  const file = join(dir, `${name}.ts`);
  writeFileSync(file, compositionSource);
  const result = spawnSync(
    join(ROOT, "node_modules", ".bin", "tsx"),
    [join(ROOT, "dist", "cli.js"), file, "--dry-run"],
    { cwd: dir, encoding: "utf8", timeout: 120_000 }
  );
  return { code: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

describe.skipIf(process.platform !== "linux")("--dry-run", () => {
  test("works on a plain composition", () => {
    const r = dryRun(
      `import { composition } from "${ROOT}/src/builder/index.js";
       export default composition({ width: 320, height: 180, fps: 24 })
         .scene({ duration: 1, background: "#141c30" }, (s) => s.text("Hi", { x: "center", y: "center" }))
         .build();`,
      "plain"
    );
    expect(r.code).toBe(0);
    expect(r.output).toContain("[kino dry-run]");
    expect(r.output).toContain("-filter_complex");
  }, 180_000);

  test("works on a `tak:` composition", () => {
    // Regression: the dry run called compile() directly, which needs PNGs that
    // only Takumi can produce. Any `s.tak()` composition failed outright.
    const r = dryRun(
      `import { composition } from "${ROOT}/src/builder/index.js";
       export default composition({ width: 320, height: 180, fps: 24 })
         .scene({ duration: 1, background: "#141c30" }, (s) => {
           s.tak("<div style='color:#fff;font-size:32px'>Hello</div>", { width: 320, height: 180 });
         })
         .build();`,
      "tak"
    );
    expect(r.output).not.toContain("without a pre-rendered PNG");
    expect(r.code).toBe(0);
    expect(r.output).toContain("[kino dry-run]");
  }, 180_000);

  test("the compiled command references a staged Takumi image", () => {
    // The PNG must actually be in the artifact, not just mentioned.
    const r = dryRun(
      `import { composition } from "${ROOT}/src/builder/index.js";
       export default composition({ width: 320, height: 180, fps: 24 })
         .scene({ duration: 1, background: "#000000" }, (s) => {
           s.tak("<div style='color:#fff'>Hi</div>", { width: 320, height: 180 });
         })
         .build();`,
      "tak-asset"
    );
    expect(r.code).toBe(0);
    // An image input appears for the rendered markup.
    expect(r.output).toMatch(/-loop 1 -i asset-\d+\.png/);
  }, 180_000);
});
