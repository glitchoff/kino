import { describe, expect, it } from "vitest";
import {
  animate,
  composition,
  defineComposition,
  fadeIn,
  html,
  image,
  popIn,
  text,
  toComposition,
  video,
} from "../src/builder/index.js";

describe("builder: composition", () => {
  it("builds a minimal composition", () => {
    const comp = composition({ width: 1080, height: 1920, fps: 30 })
      .scene({ duration: 5, background: "#0f172a" })
      .build();

    expect(comp).toEqual({
      width: 1080,
      height: 1920,
      fps: 30,
      scenes: [{ duration: 5, background: "#0f172a", elements: [] }],
    });
  });

  it("omits unset composition options", () => {
    const comp = composition().scene({ duration: 1 }).build();
    expect(Object.keys(comp)).toEqual(["scenes"]);
  });

  it("adds elements through the scene callback", () => {
    const comp = composition()
      .scene({ duration: 4 }, (s) => {
        s.text("Hello", { fontSize: 64, color: "#fff", x: "center", y: "center" });
        s.image("https://example.com/a.jpg", { width: 200 });
      })
      .build();

    expect(comp.scenes[0].elements).toEqual([
      {
        type: "text",
        content: "Hello",
        fontSize: 64,
        fontColor: "#fff",
        x: "center",
        y: "center",
      },
      { type: "image", src: "https://example.com/a.jpg", width: 200 },
    ]);
  });

  it("keeps elements added via addAll in order", () => {
    const cards = [text("A"), text("B"), text("C")];
    const comp = composition()
      .scene({ duration: 3 }, (s) => s.addAll(cards))
      .build();

    expect(comp.scenes[0].elements?.map((e) => (e as { content: string }).content)).toEqual([
      "A",
      "B",
      "C",
    ]);
  });

  it("expands a transition string to a default duration", () => {
    const comp = composition().scene({ duration: 5, transition: "fade" }).build();
    expect(comp.scenes[0].transition).toEqual({ type: "fade", duration: 0.5 });
  });

  it("keeps an explicit transition object", () => {
    const comp = composition()
      .scene({ duration: 5, transition: { type: "slideLeft", duration: 0.8 } })
      .build();
    expect(comp.scenes[0].transition).toEqual({ type: "slideLeft", duration: 0.8 });
  });

  it("supports audio, templates and prebuilt scenes", () => {
    const comp = composition({ templates: [] })
      .addScene({ duration: 1 })
      .addScenes([{ duration: 2 }, { duration: 3 }])
      .audio({ src: "https://example.com/bed.mp3", volume: 0.5 })
      .template({ id: "hero", type: "text", props: { fontSize: 120 } })
      .build();

    expect(comp.scenes).toHaveLength(3);
    expect(comp.audio).toEqual({ src: "https://example.com/bed.mp3", volume: 0.5 });
    expect(comp.templates).toEqual([{ id: "hero", type: "text", props: { fontSize: 120 } }]);
  });

  it("does not mutate the templates array passed in options", () => {
    const templates = [{ id: "a", type: "text" as const, props: {} }];
    const builder = composition({ templates });
    builder.template({ id: "b", type: "text", props: {} });
    expect(templates).toHaveLength(1);
  });
});

describe("builder: element factories", () => {
  it("maps builder aliases onto composition fields", () => {
    expect(text("x", { color: "#abc", align: "left", fontSize: 20 })).toEqual({
      type: "text",
      content: "x",
      fontColor: "#abc",
      textAlign: "left",
      fontSize: 20,
    });
  });

  it("omits undefined options instead of writing them", () => {
    const el = text("x", { fontSize: undefined, color: undefined });
    expect(Object.keys(el)).toEqual(["type", "content"]);
  });

  it("builds video and html elements", () => {
    expect(video("https://example.com/v.mp4", { loop: true, trimStart: 2 })).toEqual({
      type: "video",
      src: "https://example.com/v.mp4",
      loop: true,
      trimStart: 2,
    });

    expect(html("<b>hi</b>", { width: 400, height: 200, css: "b{}" })).toEqual({
      type: "html",
      html: "<b>hi</b>",
      width: 400,
      height: 200,
      css: "b{}",
    });
  });

  it("passes shared element options through", () => {
    const el = image("a.jpg", { startAt: 2, duration: 3, zIndex: 5, animation: { opacity: fadeIn(0.4) } });
    expect(el).toMatchObject({ startAt: 2, duration: 3, zIndex: 5 });
    expect(el.animation?.opacity).toEqual({ from: 0, to: 1, duration: 0.4, easing: "easeOut" });
  });
});

describe("builder: animation helpers", () => {
  it("produces the documented shapes", () => {
    expect(animate({ from: 0, to: 10, duration: 1 })).toEqual({ from: 0, to: 10, duration: 1 });
    expect(fadeIn()).toEqual({ from: 0, to: 1, duration: 0.5, easing: "easeOut" });
    expect(popIn()).toEqual({ from: 0.8, to: 1, duration: 0.4, easing: "easeOut" });
  });
});

describe("builder: helpers", () => {
  it("defineComposition is identity", () => {
    const comp = { scenes: [{ duration: 1 }] };
    expect(defineComposition(comp)).toBe(comp);
  });

  it("toComposition builds a builder and passes objects through", () => {
    const builder = composition().scene({ duration: 1 });
    expect(toComposition(builder)).toEqual({ scenes: [{ duration: 1, elements: [] }] });

    const plain = { scenes: [{ duration: 2 }] };
    expect(toComposition(plain)).toBe(plain);
  });
});

describe("builder: JSON equivalence", () => {
  it("emits the same object a hand-written JSON composition would", () => {
    const json = {
      width: 1080,
      height: 1920,
      fps: 30,
      scenes: [
        {
          duration: 5,
          background: "#0f172a",
          elements: [
            { type: "text", content: "Hi", fontSize: 64, fontColor: "#fff", x: "center" },
            { type: "image", src: "a.jpg", width: 300 },
          ],
        },
      ],
    } as const;

    const built = composition({ width: 1080, height: 1920, fps: 30 })
      .scene({ duration: 5, background: "#0f172a" }, (s) =>
        s.text("Hi", { fontSize: 64, color: "#fff", x: "center" }).image("a.jpg", { width: 300 })
      )
      .build();

    expect(built).toEqual(json);
    // Must survive a JSON round trip unchanged — it is a plain data object.
    expect(JSON.parse(JSON.stringify(built))).toEqual(json);
  });
});
