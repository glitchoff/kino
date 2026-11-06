import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
describe("fetchWithYtdlp (stubbed binary)", () => {
  let binDir: string;
  let workDir: string;
  let originalPath: string | undefined;
  let lastArgs = "";

  beforeAll(() => {
    binDir = mkdtempSync(join(tmpdir(), "kino-ytdlp-bin-"));
    workDir = mkdtempSync(join(tmpdir(), "kino-ytdlp-work-"));

    // Writes a tiny file at the -o template path and prints its final path.
    const script = `#!/usr/bin/env node
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
    const bin = join(binDir, "yt-dlp");
    writeFileSync(bin, script);
    chmodSync(bin, 0o755);

    originalPath = process.env.PATH;
    process.env.PATH = `${binDir}:${originalPath}`;
  });

  afterAll(() => {
    process.env.PATH = originalPath;
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
    process.env.PATH = mkdtempSync(join(tmpdir(), "empty-path-"));
    try {
      expect(() =>
        fetchWithYtdlp("https://example.com/x", { stagingDir: mkdtempSync(join(tmpdir(), "s-")) })
      ).toThrow(/not found on PATH/);
    } finally {
      process.env.PATH = savedPath;
    }
  });
});
