import { describe, test, expect } from "vitest";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruneAssetCache, assetCacheKey } from "../src/remote/index.js";

describe("asset cache", () => {
  test("key is stable, distinct per URL, and filename-safe", () => {
    const a = assetCacheKey("https://example.com/x.png");
    expect(a).toBe(assetCacheKey("https://example.com/x.png"));
    expect(a).not.toBe(assetCacheKey("https://example.com/y.png"));
    expect(a).toMatch(/^[a-f0-9]{32}$/);
  });

  test("prune keeps referenced URLs and drops the rest", () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-cache-"));
    const keep = assetCacheKey("https://example.com/keep.png");
    const drop = assetCacheKey("https://example.com/drop.png");
    try {
      for (const key of [keep, drop]) {
        writeFileSync(join(dir, `${key}.bin`), "x");
        writeFileSync(join(dir, `${key}.json`), "{}");
      }
      expect(pruneAssetCache(dir, ["https://example.com/keep.png"])).toBe(2);
      expect(readdirSync(dir).sort()).toEqual([`${keep}.bin`, `${keep}.json`]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
