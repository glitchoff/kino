import { describe, test, expect } from "vitest";
import { composition, merge, scene, text, image, type KinoScene } from "../src/index.js";

/**
 * Scenes as values.
 *
 * The point of `scene()` is that a scene can be held in a variable and merged
 * more than once, which the builder's `.scene()` cannot do — it appends and
 * returns the composition, so the scene is gone by the time you have a name
 * for it.
 */
describe("scene()", () => {
  test("produces the same object the builder would", () => {
    const built = scene({ for: 5, bg: "#0f172a" }, [text("Hi", { fontSize: 40 })]);
    const chained = composition()
      .scene({ duration: 5, background: "#0f172a" }, (s) => s.text("Hi", { fontSize: 40 }))
      .build().scenes[0];

    expect(built).toEqual(chained);
  });

  test("a string transition gets the same 0.5s default as the builder", () => {
    const s = scene({ for: 3, transition: "fade" });
    expect(s.transition).toEqual({ type: "fade", duration: 0.5 });
  });

  test("an object transition is passed through", () => {
    const s = scene({ for: 3, transition: { type: "slideLeft", duration: 1 } });
    expect(s.transition).toEqual({ type: "slideLeft", duration: 1 });
  });

  test("omits what it was not given, so the JSON stays clean", () => {
    expect(scene({ for: 2 })).toEqual({ duration: 2, elements: [] });
  });

  test("a narration fit is passed through untouched", () => {
    const fit = { fit: { __kinoVoice: true, seconds: 3 } as const, pad: 0.4 };
    expect(scene({ for: fit }).duration).toBe(fit);
  });
});

describe("merge()", () => {
  test("joins scenes in argument order", () => {
    const a = scene({ for: 1, id: "a" });
    const b = scene({ for: 2, id: "b" });
    expect(merge(a, b).scenes.map((s) => s.id)).toEqual(["a", "b"]);
  });

  test("reuses the same scene value twice", () => {
    const chorus = scene({ for: 4, id: "chorus" }, [text("Sing")]);
    const merged = merge(scene({ for: 2, id: "intro" }), chorus, chorus);

    expect(merged.scenes.map((s) => s.id)).toEqual(["intro", "chorus", "chorus"]);
    // Same object both times: a scene is a value, not a cursor.
    expect(merged.scenes[1]).toBe(merged.scenes[2]);
  });

  test("flattens arrays and nesting", () => {
    const a = scene({ for: 1, id: "a" });
    const b = scene({ for: 1, id: "b" });
    const c = scene({ for: 1, id: "c" });

    expect(merge([a, b], [[c]]).scenes.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  test("takes compositions and builders, contributing their scenes", () => {
    const built = composition({ width: 800, height: 600, fps: 24 })
      .scene({ duration: 2 }, (s) => s.text("A"))
      .build();

    const merged = merge(built, scene({ for: 1, id: "b" }));

    expect(merged.scenes).toHaveLength(2);
    expect(merged.scenes[1].id).toBe("b");
    // The first composition's canvas becomes the merged canvas.
    expect(merged.width).toBe(800);
    expect(merged.height).toBe(600);
    expect(merged.fps).toBe(24);
  });

  test("a builder merges the same way its built form does", () => {
    const builder = composition({ width: 640 }).scene({ duration: 1 }, (s) => s.text("x"));
    const merged = merge(builder, scene({ for: 1 }));

    expect(merged.width).toBe(640);
    expect(merged.scenes).toHaveLength(2);
  });

  test("a scene alone is a valid one-scene composition", () => {
    const only = scene({ for: 2 }, [text("Hi")]);
    expect(merge(only).scenes).toEqual([only]);
  });

  test("nothing merged is an empty composition, not a crash", () => {
    expect(merge().scenes).toEqual([]);
  });

  test("does not mutate the scenes it was given", () => {
    const a = scene({ for: 1, id: "a" });
    const before = JSON.stringify(a);
    merge(a, a);
    expect(JSON.stringify(a)).toBe(before);
  });
});

describe("merge() with a real composition", () => {
  test("a merged scene normalises like any other", async () => {
    const { normalizeComposition } = await import("../src/normalize/index.js");

    const intro = scene({ for: 2, bg: "#000" }, [text("Intro")]);
    const chorus = scene({ for: 3, bg: "#111" }, [text("Chorus")]);
    const norm = normalizeComposition(merge(intro, chorus, chorus));

    expect(norm.scenes.map((s) => s.startTime)).toEqual([0, 2, 5]);
    expect(norm.scenes[2].elements[0].startTime).toBe(5);
  });

  test("a merged composition reaches the same filtergraph as a chained one", async () => {
    const { compile } = await import("../src/pipeline/compile.js");
    const { normalizeComposition } = await import("../src/normalize/index.js");

    const viaMerge = normalizeComposition(
      merge(
        scene({ for: 1, bg: "#000" }, [text("A", { x: "center", y: "center" })]),
        scene({ for: 1, bg: "#000" }, [text("B", { x: "center", y: "center" })])
      )
    );
    const viaChain = normalizeComposition(
      composition()
        .scene({ duration: 1, background: "#000" }, (s) => s.text("A", { x: "center", y: "center" }))
        .scene({ duration: 1, background: "#000" }, (s) => s.text("B", { x: "center", y: "center" }))
        .build()
    );

    const a = compile(viaMerge, { stagingDir: "/tmp/kino-merge-test" });
    const b = compile(viaChain, { stagingDir: "/tmp/kino-merge-test" });

    expect(a.args).toEqual(b.args);
  });
});
