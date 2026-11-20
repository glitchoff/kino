import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname } from "node:path";

let dir: string;
// Resolve from this file, not cwd: vitest can run from a different directory.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// The root goes into generated TypeScript source, where a Windows path's
// backslashes are escape sequences (`\k` becomes `k`). Forward slashes are
// valid in an import specifier on every platform.
const ROOT_URL = ROOT.replace(/\\/g, "/");

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
  // Invoke tsx through node with its loader rather than the `.bin/tsx` shim:
  // on Windows the shim is a .cmd, which spawnSync cannot execute directly and
  // returns a null status for. The loader is addressed by path because the test
  // runs with a temp dir as cwd, where `tsx` does not resolve.
  const tsxLoader = join(ROOT, "node_modules", "tsx", "dist", "loader.mjs");
  const result = spawnSync(
    process.execPath,
    ["--import", pathToFileURL(tsxLoader).href, join(ROOT, "dist", "cli.js"), file, "--dry-run"],
    { cwd: dir, encoding: "utf8", timeout: 120_000 }
  );
  return { code: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

describe.skipIf(process.platform !== "linux")("--dry-run", () => {
  test("works on a plain composition", () => {
    const r = dryRun(
      `import { composition } from "${ROOT_URL}/src/builder/index.js";
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
      `import { composition } from "${ROOT_URL}/src/builder/index.js";
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
      `import { composition } from "${ROOT_URL}/src/builder/index.js";
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

describe("filtergraph length", () => {
  /**
   * Windows stores a command line in a 16-bit length field, so CreateProcess
   * rejects anything past 32,767 characters. A filtergraph between that ceiling
   * and the POSIX ARG_MAX used to take the inline `-filter_complex` branch and
   * fail at spawn with ENAMETOOLONG, so the graph must be written to a script
   * file well below 32,767.
   */
  test("a graph near the Windows ceiling is written to a script file", () => {
    // Enough text elements to push the graph past 30,000 characters.
    const filler = Array.from({ length: 420 }, (_, i) => `s.text("row ${i} of padding text", { y: ${20 + i} })`).join(";\n           ");
    const r = dryRun(
      `import { composition } from "${ROOT_URL}/src/builder/index.js";
       export default composition({ width: 320, height: 180, fps: 24 })
         .scene({ duration: 1, background: "#141c30" }, (s) => {
           ${filler};
         })
         .build();`,
      "long-graph"
    );
    // Surface the CLI's own output when the dry run fails, so a Windows
    // spawn problem is diagnosable from the test run rather than a bare code.
    if (r.code !== 0) console.error(`dry run failed (${r.code}):\n${r.output.slice(0, 2000)}`);
    expect(r.code).toBe(0);
    expect(r.output).toContain("-filter_complex_script");
    expect(r.output).not.toContain("-filter_complex ");
  }, 180_000);
});
