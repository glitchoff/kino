import { describe, test, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeComposition } from "../src/normalize/index.js";
import { planSegments, segmentHash, writeConcatList } from "../src/pipeline/segment-cache.js";
import { composition } from "../src/builder/index.js";

const dirs: string[] = [];
function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), "kino-seg-"));
  dirs.push(d);
  return d;
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function sample(opts: { fade?: boolean; middleText?: string } = {}) {
  const { fade = true, middleText = "Middle" } = opts;
  return composition({ width: 640, height: 360, fps: 30 })
    .scene({ id: "a", duration: 4, background: "#111" }, (s) => s.text("A", { x: 10, y: 10 }))
    .scene(
      { id: "b", duration: 4, background: "#222", transition: fade ? { type: "fade", duration: 1 } : undefined },
      (s) => s.text(middleText, { x: 10, y: 10 })
    )
    .scene(
      { id: "c", duration: 4, background: "#333", transition: { type: "fade", duration: 0.5 } },
      (s) => s.text("C", { x: 10, y: 10 })
    )
    .build();
}

describe("segment cache", () => {
  test("segments own abutting slices of the timeline", () => {
    const norm = normalizeComposition(sample());
    const segs = planSegments(norm, scratch());

    expect(segs.map((s) => s.id)).toEqual(["a", "b", "c"]);

    // Every segment's slice begins where the next scene begins, so the joins
    // are seamless and no frame is counted twice.
    for (let i = 0; i < segs.length - 1; i++) {
      const ownStart = Number(norm.scenes[i].startTime ?? 0);
      const nextStart = Number(norm.scenes[i + 1].startTime ?? 0);
      expect(segs[i].duration).toBeCloseTo(nextStart - ownStart, 5);
    }

    // The last segment runs to the end of the composition.
    const last = segs[segs.length - 1];
    const lastStart = Number(norm.scenes[2].startTime ?? 0);
    expect(last.duration).toBeCloseTo(norm.duration - lastStart, 5);
  });

  test("a transitioned scene renders together with its predecessor", () => {
    const segs = planSegments(normalizeComposition(sample()), scratch());

    // Scene a has no predecessor: it stands alone.
    expect(segs[0].renderIndices).toEqual([0]);
    expect(segs[0].offset).toBe(0);

    // Scene b fades from a, so a is rendered too and discarded by `offset`.
    // a runs 0→4 and b starts at 3, so the pair is rendered from 0 and b's
    // slice begins 3s in.
    expect(segs[1].renderIndices).toEqual([0, 1]);
    expect(segs[1].offset).toBeCloseTo(3, 5);

    expect(segs[2].renderIndices).toEqual([1, 2]);
    // b starts at 3, c at 6.5.
    expect(segs[2].offset).toBeCloseTo(3.5, 5);
  });

  test("editing a scene changes its hash and its neighbour's", () => {
    const before = normalizeComposition(sample());
    const after = normalizeComposition(sample({ middleText: "Edited" }));

    expect(segmentHash(after, 1)).not.toBe(segmentHash(before, 1));
    // c renders together with b, so b's content is part of c's segment.
    expect(segmentHash(after, 2)).not.toBe(segmentHash(before, 2));
    // a is untouched and does not include b.
    expect(segmentHash(after, 0)).toBe(segmentHash(before, 0));
  });

  test("an unchanged composition produces identical hashes", () => {
    const a = normalizeComposition(sample());
    const b = normalizeComposition(sample());
    expect(segmentHash(b, 0)).toBe(segmentHash(a, 0));
    expect(segmentHash(b, 1)).toBe(segmentHash(a, 1));
    expect(segmentHash(b, 2)).toBe(segmentHash(a, 2));
  });

  test("without transitions each scene is its own segment", () => {
    const segs = planSegments(normalizeComposition(sample({ fade: false })), scratch());
    expect(segs[1].renderIndices).toEqual([1]);
    expect(segs[1].offset).toBe(0);
  });

  test("a cached file is reported as a hit, a missing one as a miss", () => {
    const dir = scratch();
    const norm = normalizeComposition(sample());
    const first = planSegments(norm, dir);
    expect(first.every((s) => !s.cached)).toBe(true);

    // Pretend the first segment rendered.
    writeConcatList(first, join(dir, "concat.txt"));
    writeFileSync(first[0].path, "stub");

    const second = planSegments(norm, dir);
    expect(second[0].cached).toBe(true);
    expect(second[1].cached).toBe(false);
    expect(existsSync(first[0].path)).toBe(true);
  });
});
