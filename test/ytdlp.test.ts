import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fetchWithYtdlp, isYtdlpSource, ytdlpUrl, ytdlpReason } from "../src/remote/ytdlp.js";

describe("yt-dlp source markers", () => {
  test("recognises and strips the yt: prefix", () => {
    expect(isYtdlpSource("yt:https://youtube.com/watch?v=x")).toBe(true);
    expect(isYtdlpSource("https://youtube.com/watch?v=x")).toBe(false);
    expect(ytdlpUrl("yt:https://youtube.com/watch?v=x")).toBe("https://youtube.com/watch?v=x");
  });
});

describe("ytdlpReason", () => {
  const cases: Array<[string, RegExp]> = [
    ["ERROR: [youtube] abc: Sign in to confirm you\u2019re not a bot.", /sign-in/],
    ["ERROR: [youtube] abc: Private video. If the owner...", /private/i],
    ["ERROR: [youtube] abc: Video unavailable", /unavailable/i],
    ["ERROR: Unsupported URL: https://example.com/x", /does not support/i],
    ["ERROR: [youtube] abc: The current session has been rate-limited by YouTube", /rate limited/i],
  ];

  test.each(cases)("maps %s", (stderr, expected) => {
    expect(ytdlpReason(stderr)).toMatch(expected);
  });

  test("falls back to the raw error text", () => {
    expect(ytdlpReason("ERROR: something odd happened")).toBe("something odd happened");
  });

  test("picks the last ERROR line", () => {
    const stderr = "ERROR: first\nWARNING: noise\nERROR: [youtube] x: Private video";
    expect(ytdlpReason(stderr)).toMatch(/private/i);
  });
});

// A fake `yt-dlp` on PATH lets the test exercise spawnSync, the
// `--print after_move:filepath` contract, and the cache without a network call.
//
// **Optional by design.** The stub is a `.cmd` wrapper on Windows and a shebang
// script elsewhere, so whether the OS launches it depends on the machine rather
// than on kino. A yt-dlp test failing because the stub cannot launch says
// nothing about the library, so the block skips instead of failing.
//
// The probe runs the same wrapper the tests use, through the same `shell: true`
// spawn, so it fails for the same reasons the tests would. (This is how the
// unquoted `bv*[height<=720]` bug was found: the stub could not start because
// cmd read `<` and `>` as redirection. See `quoteForShell` in ytdlp.ts.)
//
// Set `KINO_REQUIRE_YTDLP=1` to turn a skip back into a failure — for CI, where
// the stub is known to work.
const stubRunnable = (() => {
  if (process.env.KINO_REQUIRE_YTDLP === "1") return true;
  try {
    const dir = mkdtempSync(join(tmpdir(), "kino-ytdlp-probe-"));
    const js = join(dir, "probe.js");
    writeFileSync(
      js,
      `const fs=require("node:fs");const out=process.argv[2];` +
        `fs.writeFileSync(out,"ok");process.stdout.write(out);`
    );
    const target = join(dir, "out.mp4");
    let bin: string;
    if (process.platform === "win32") {
      bin = join(dir, "yt-dlp.cmd");
      writeFileSync(bin, `@node "${js}" %*\r\n`);
    } else {
      bin = join(dir, "yt-dlp");
      writeFileSync(bin, `#!/usr/bin/env node\n${readFileSync(js, "utf8")}`);
      chmodSync(bin, 0o755);
    }
    const res = spawnSync(bin, [target], {
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    const ok = res.status === 0 && existsSync(target);
    rmSync(dir, { recursive: true, force: true });
    return ok;
  } catch {
    return false;
  }
})();

describe.skipIf(!stubRunnable)("fetchWithYtdlp (stubbed binary)", () => {
  let binDir: string;
  let workDir: string;
  let originalPath: string | undefined;
  let originalBin: string | undefined;
  let lastArgs = "";

  beforeAll(() => {
    binDir = mkdtempSync(join(tmpdir(), "kino-ytdlp-bin-"));
    workDir = mkdtempSync(join(tmpdir(), "kino-ytdlp-work-"));

    // A fake `yt-dlp` on PATH lets the test exercise spawnSync, the
    // `--print after_move:filepath` contract, and the cache without a network call.
    //
    // Windows cannot execute a `#!/usr/bin/env node` script the way Unix can: it
    // has no shebang handling, ignores the `0o755` bit, and resolves a bare name
    // through PATHEXT (`.EXE`, `.CMD`, ...). A script named `yt-dlp` with no
    // extension was therefore invisible, and once a real yt-dlp was on PATH the
    // test found *that* instead and hit the network. So the stub is a `.cmd`
    // wrapper that hands the same body to node, and PATH is joined with the
    // platform separator.
    const script = `
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(join(binDir, "invocations"))}, "1");
fs.writeFileSync(${JSON.stringify(join(binDir, "args.log"))}, args.join("\\n"));
const out = args[args.indexOf("-o") + 1];
const file = out.replace("%(ext)s", "mp4");
fs.writeFileSync(file, "fake-video-bytes");
process.stdout.write(file + "\\n");
`;
    const isWindows = process.platform === "win32";
    const jsPath = join(binDir, "yt-dlp-stub.js");
    writeFileSync(jsPath, script);

    let bin: string;
    if (isWindows) {
      bin = join(binDir, "yt-dlp.cmd");
      // `@node "..." %*` forwards every argument unchanged.
      writeFileSync(bin, `@node "${jsPath}" %*\r\n`);
    } else {
      bin = join(binDir, "yt-dlp");
      writeFileSync(bin, `#!/usr/bin/env node\n${script}`);
      chmodSync(bin, 0o755);
    }

    originalPath = process.env.PATH;
    process.env.PATH = `${binDir}${delimiter}${originalPath}`;
    // PATH alone is not enough on Windows: PATHEXT resolves `.exe` before
    // `.cmd`, so a real yt-dlp already installed wins over the stub and the test
    // hits the network. Naming the stub explicitly makes the test independent of
    // what the machine has installed.
    originalBin = process.env.KINO_YTDLP;
    process.env.KINO_YTDLP = bin;
  });

  afterAll(() => {
    process.env.PATH = originalPath;
    if (originalBin === undefined) delete process.env.KINO_YTDLP;
    else process.env.KINO_YTDLP = originalBin;
    rmSync(binDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  test("downloads into the staging dir and returns the staged name", () => {
    const staging = mkdtempSync(join(tmpdir(), "kino-ytdlp-stage-"));
    const name = fetchWithYtdlp("https://example.com/v", { stagingDir: staging });
    expect(name).toMatch(/^yt-[a-f0-9]{32}\.mp4$/);
    expect(existsSync(join(staging, name))).toBe(true);
    expect(readFileSync(join(staging, name), "utf-8")).toBe("fake-video-bytes");
  });

  test("survives a format selector containing shell metacharacters", () => {
    // Regression: with `shell: true` on Windows, Node joins argv without
    // escaping, so cmd read `<` and `>` in `bv*[height<=720]` as redirection and
    // the spawn died with "The system cannot find the file specified". Every
    // yt: source failed on Windows, and only the stubbed test caught it.
    const staging = mkdtempSync(join(tmpdir(), "kino-ytdlp-stage-"));
    const name = fetchWithYtdlp("https://example.com/meta", { stagingDir: staging, maxHeight: 720 });
    expect(name).toMatch(/^yt-[a-f0-9]{32}\.mp4$/);
    expect(existsSync(join(staging, name))).toBe(true);
  });

  test("passes the flags that matter", () => {
    const staging = mkdtempSync(join(tmpdir(), "kino-ytdlp-stage-"));
    fetchWithYtdlp("https://example.com/flags", { stagingDir: staging });
    lastArgs = readFileSync(join(binDir, "args.log"), "utf-8").split("\n");
    expect(lastArgs).toContain("--ignore-config");
    expect(lastArgs).toContain("--no-playlist");
    expect(lastArgs).toContain("--js-runtimes");
    expect(lastArgs).toContain("after_move:filepath");
    // Trimming happens in Kino, not here.
    expect(lastArgs).not.toContain("--download-sections");
    const fmt = lastArgs[lastArgs.indexOf("-f") + 1];
    expect(fmt).toContain("height<=720");
  });

  test("honours a height cap", () => {
    const staging = mkdtempSync(join(tmpdir(), "kino-ytdlp-stage-"));
    fetchWithYtdlp("https://example.com/hd", { stagingDir: staging, maxHeight: 1080 });
    const args = readFileSync(join(binDir, "args.log"), "utf-8").split("\n");
    expect(args[args.indexOf("-f") + 1]).toContain("height<=1080");
  });

  test("caches by URL so a second fetch skips yt-dlp", () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "kino-ytdlp-cache-"));
    const url = "https://example.com/cached";
    const first = fetchWithYtdlp(url, { stagingDir: mkdtempSync(join(tmpdir(), "s-")), cacheDir });
    // Count invocations: a cache hit must not spawn yt-dlp at all.
    const marker = join(binDir, "invocations");
    writeFileSync(marker, "1");
    try {
      const second = fetchWithYtdlp(url, { stagingDir: mkdtempSync(join(tmpdir(), "s-")), cacheDir });
      expect(second).toBe(first);
      expect(readFileSync(marker, "utf-8")).toBe("1"); // unchanged => not called
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
      rmSync(marker, { force: true });
    }
  });

  test("reports a missing binary clearly", () => {
    const savedPath = process.env.PATH;
    const savedBin = process.env.KINO_YTDLP;
    // Point at a name that cannot resolve, and empty PATH so nothing else can
    // satisfy it either.
    process.env.PATH = mkdtempSync(join(tmpdir(), "empty-path-"));
    process.env.KINO_YTDLP = "kino-definitely-not-installed";
    try {
      expect(() =>
        fetchWithYtdlp("https://example.com/x", { stagingDir: mkdtempSync(join(tmpdir(), "s-")) })
      ).toThrow(/not found on PATH/);
    } finally {
      process.env.PATH = savedPath;
      if (savedBin === undefined) delete process.env.KINO_YTDLP;
      else process.env.KINO_YTDLP = savedBin;
    }
  });
});
