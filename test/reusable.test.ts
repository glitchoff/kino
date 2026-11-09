import { describe, test, expect } from "vitest";
import {
  elements,
  fadeIn,
  fadeOut,
  image,
  merge,
  preset,
  rect,
  repeat,
  scene,
  shift,
  slideIn,
  text,
  variants,
  withDefaults,
  withOptions,
  type SceneProps,
} from "../src/index.js";

/**
 * Reusable pieces.
 *
 * `scene()` made a scene a value. These are the rest of the same idea: an
 * element can be dressed after the fact, a group of elements can be passed as
 * one, a scene can be repeated, and a set of scenes can share their props.
 */

describe("withOptions()", () => {
  test("adds options to an element made without them", () => {
    const title = text("Hello", { fontSize: 96 });
    const placed = withOptions(title, { y: "center", animation: fadeIn(0.4) });

    expect(placed.fontSize).toBe(96);
    expect(placed.y).toBe("center");
    // A bare animation is shorthand for the opacity channel; normalization
    // only reads named channels, so storing it bare would drop it silently.
    expect(placed.animation).toEqual({
      opacity: { from: 0, to: 1, duration: 0.4, easing: "easeOut" },
    });
  });

  test("an animation on the opacity channel is left as it is", () => {
    const anim = { opacity: fadeIn(0.5), y: slideIn("y", 20) };
    expect(withOptions(text("Hi"), { animation: anim }).animation).toEqual(anim);
  });

  test("renames text options the way the factories do", () => {
    const placed = withOptions(text("Hi"), { color: "#000", align: "left" });
    expect(placed.fontColor).toBe("#000");
    expect(placed.textAlign).toBe("left");
  });

  test("later options win", () => {
    expect(withOptions(text("Hi", { color: "#fff" }), { color: "#000" }).fontColor).toBe("#000");
  });

  test("leaves the element alone for undefined values", () => {
    const placed = withOptions(text("Hi", { y: 10 }), { y: undefined });
    expect(placed.y).toBe(10);
  });

  test("does not mutate the element it was given", () => {
    const title = text("Hi", { fontSize: 40 });
    const before = JSON.stringify(title);
    withOptions(title, { y: "center" });
    expect(JSON.stringify(title)).toBe(before);
  });

  test("keeps the element's kind, so it still compiles", () => {
    const img = withOptions(image("./x.jpg", { width: 640 }), { x: "center" });
    expect(img.type).toBe("image");
    expect(img.src).toBe("./x.jpg");
    expect(img.width).toBe(640);
  });
});

describe("preset()", () => {
  test("merges nested groups key by key, which withDefaults does not", () => {
    const dark = preset({ color: "#fff", stroke: { color: "#000", width: 4 } });
    const big = preset({ fontSize: 96 }, dark);

    expect(big).toEqual({ fontSize: 96, color: "#fff", stroke: { color: "#000", width: 4 } });
  });

  test("a later layer overrides a nested key without dropping its siblings", () => {
    const a = preset({ stroke: { color: "#000", width: 4 } });
    const b = preset(a, { stroke: { width: 10 } });
    expect(b.stroke).toEqual({ color: "#000", width: 10 });
  });

  test("skips undefined, so a missing layer changes nothing", () => {
    expect(preset({ fontSize: 20 }, undefined, { color: "#fff" })).toEqual({ fontSize: 20, color: "#fff" });
    expect(preset({ fontSize: 20 }, { color: undefined })).toEqual({ fontSize: 20 });
  });

  test("does not merge arrays", () => {
    const a = preset({ keyframes: [1, 2] } as Record<string, unknown>);
    const b = preset(a, { keyframes: [3] } as Record<string, unknown>);
    expect(b.keyframes).toEqual([3]);
  });

  test("feeds withDefaults directly", () => {
    const Title = withDefaults(text, preset({ fontSize: 96, color: "#fff" }));
    expect(Title("Hi").fontSize).toBe(96);
    expect(Title("Hi", { fontSize: 20 }).fontSize).toBe(20);
  });
});

describe("elements()", () => {
  test("flattens nested arrays", () => {
    const a = text("a");
    const b = text("b");
    const c = text("c");
    expect(elements([a, [b]], c)).toEqual([a, b, c]);
  });

  test("calls factories, so a component can be lazy", () => {
    let calls = 0;
    const lazy = () => {
      calls++;
      return text("built");
    };
    const out = elements(lazy);

    expect(calls).toBe(1);
    expect(out[0].content).toBe("built");
  });

  test("a group component composes with another group", () => {
    const lowerThird = (name: string) =>
      elements(
        rect({ width: 12, height: 120, x: 80, y: "bottom-160", fill: "#38bdf8" }),
        text(name, { x: 116, y: "bottom-150", fontSize: 52 })
      );

    const title = elements(text("Intro", { fontSize: 96 }), text("part one"));
    const all = elements(title, lowerThird("Alice"));

    expect(all).toHaveLength(4);
    expect(all.map((e) => e.type)).toEqual(["text", "text", "shape", "text"]);
  });

  test("nothing gives an empty list, which a scene accepts", () => {
    expect(elements()).toEqual([]);
    expect(scene({ for: 1 }, elements()).elements).toEqual([]);
  });
});

describe("shift()", () => {
  test("delays a simple animation", () => {
    expect(shift(fadeIn(0.4), 1)).toEqual({ from: 0, to: 1, duration: 0.4, easing: "easeOut", delay: 1 });
  });

  test("adds to an existing delay", () => {
    const anim = { ...fadeIn(0.4), delay: 0.5 };
    expect(shift(anim, 1)).toMatchObject({ delay: 1.5 });
  });

  test("clamps a negative offset to zero", () => {
    const out = shift(fadeIn(0.4), -5);
    expect("delay" in out).toBe(false);
  });

  test("moves every keyframe of a keyframed animation", () => {
    const out = shift({ keyframes: [{ at: 0, value: 0 }, { at: 1, value: 1 }] }, 2);
    expect("keyframes" in out && out.keyframes.map((k) => k.at)).toEqual([2, 3]);
  });

  test("does not mutate the animation", () => {
    const anim = fadeIn(0.4);
    shift(anim, 1);
    expect(anim).toEqual({ from: 0, to: 1, duration: 0.4, easing: "easeOut" });
  });

  test("accepts a string offset, since durations may be expressions", () => {
    expect(shift(fadeOut(0.2), "0.5")).toMatchObject({ delay: 0.5 });
  });
});

describe("repeat()", () => {
  test("repeats a scene the given number of times", () => {
    const chorus = scene({ for: 4, id: "chorus" });
    expect(repeat(chorus, 3).map((s) => s.id)).toEqual(["chorus", "chorus", "chorus"]);
  });

  test("every repetition is the same object", () => {
    const chorus = scene({ for: 4 });
    const out = repeat(chorus, 2);
    expect(out[0]).toBe(out[1]);
  });

  test("repeats every scene of a composition", () => {
    const pair = merge(scene({ for: 1, id: "a" }), scene({ for: 1, id: "b" }));
    expect(repeat(pair, 2).map((s) => s.id)).toEqual(["a", "b", "a", "b"]);
  });

  test("a gap lengthens the scene rather than adding one, so its background holds", () => {
    const chorus = scene({ for: 4, id: "chorus" });
    const out = repeat(chorus, { times: 2, gap: 1 });

    expect(out).toHaveLength(2);
    expect(out[0].duration).toBe(5);
    // A copy, because its duration differs — the original is untouched.
    expect(out[0]).not.toBe(chorus);
    expect(chorus.duration).toBe(4);
  });

  test("a gap leaves a narration-sized scene alone", () => {
    const fit = { fit: { __kinoVoice: true, seconds: 3 } as const };
    const out = repeat(scene({ for: fit }), { times: 2, gap: 1 });
    expect(out[0].duration).toBe(fit);
  });

  test("zero or a negative count gives nothing", () => {
    expect(repeat(scene({ for: 1 }), 0)).toEqual([]);
    expect(repeat(scene({ for: 1 }), -2)).toEqual([]);
  });
});

describe("variants()", () => {
  const base: SceneProps = { for: 4, bg: "#111827", transition: "fade" };

  test("shares props and overrides per variant", () => {
    const [verse, chorus] = variants(base, [
      { id: "verse", elements: text("I") },
      { id: "chorus", elements: text("We"), for: 6 },
    ]);

    expect(verse.background).toBe("#111827");
    expect(verse.duration).toBe(4);
    expect(verse.elements?.[0].content).toBe("I");
    expect(chorus.duration).toBe(6);
    expect(chorus.id).toBe("chorus");
    // The shared transition survives on both.
    expect(chorus.transition).toEqual({ type: "fade", duration: 0.5 });
  });

  test("takes a group of elements, not just one", () => {
    const [card] = variants(base, [{ elements: elements(text("a"), text("b")) }]);
    expect(card.elements).toHaveLength(2);
  });

  test("an undefined override does not erase the shared prop", () => {
    const [v] = variants(base, [{ for: undefined }]);
    expect(v.duration).toBe(4);
  });

  test("the result merges like any other scene", () => {
    const scenes = variants(base, [{ id: "a", elements: text("a") }, { id: "b", elements: text("b") }]);
    expect(merge(...scenes).scenes.map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("reusable pieces reach the compiler unchanged", () => {
  test("a composition built from them normalises with the right timings", async () => {
    const { normalizeComposition } = await import("../src/normalize/index.js");

    const card = variants({ for: 2, bg: "#000" }, [
      { id: "a", elements: elements(text("A"), withOptions(text("sub"), { y: "bottom-80" })) },
      { id: "b", elements: text("B") },
    ]);

    const norm = normalizeComposition(merge(card[0], repeat(card[1], 2)));

    expect(norm.scenes.map((s) => s.startTime)).toEqual([0, 2, 4]);
    expect(norm.scenes[0].elements).toHaveLength(2);
    expect(norm.scenes[0].elements[1].y).toBe("bottom-80");
  });

  test("a delayed animation survives normalization", async () => {
    const { normalizeComposition } = await import("../src/normalize/index.js");

    const card = variants({ for: 2, bg: "#000" }, [
      { elements: withOptions(text("sub"), { animation: shift(fadeIn(0.3), 0.2) }) },
    ]);
    const elem = normalizeComposition(merge(card[0])).scenes[0].elements[0];

    expect(elem.animation?.opacity).toMatchObject({ from: 0, to: 1, duration: 0.3, delay: 0.2 });
  });
});
