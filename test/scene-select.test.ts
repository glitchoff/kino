import { describe, test, expect } from "vitest";
import { compile } from "../src/pipeline/index.js";
import { normalizeComposition, selectScene } from "../src/normalize/index.js";
import { parseRenderArgs } from "../src/cli-args.js";
import { composition } from "../src/builder/index.js";

function sample() {
  return composition({ width: 640, height: 360, fps: 30 })
    .scene({ id: "intro", duration: 2, background: "#111" }, (s) =>
      s.text("Intro", { x: "center", y: "center" })
    )
    .scene({ id: "middle", duration: 3, background: "#222", transition: { type: "fade", duration: 0.5 } }, (s) =>
      s.text("Middle", { x: "center", y: "center", startAt: 1 })
    )
    .scene({ id: "outro", duration: 2, background: "#333" }, (s) =>
      s.text("Outro", { x: "center", y: "center" })
    )
    .build();
}

describe("--scene", () => {
  test("selectScene rebases the chosen scene to zero", () => {
    const norm = normalizeComposition(sample());
    const middle = norm.scenes.find((s) => s.id === "middle")!;
    const picked = selectScene(norm, "middle");

    expect(picked.scenes).toHaveLength(1);
    expect(picked.scenes[0].startTime).toBe(0);
    expect(picked.duration).toBe(3);
    // Element startTime is relative to the scene again.
    expect(picked.elements[0].startTime).toBe(1);
    expect(picked.scenes[0].startTime).toBe(middle.startTime - middle.startTime);
  });

  test("transitions are dropped — a lone scene has no neighbour", () => {
    const picked = selectScene(normalizeComposition(sample()), "middle");
    expect(picked.scenes[0].transition).toBeUndefined();
  });

  test("compile(--scene) produces a shorter render than the whole composition", () => {
    const full = compile(sample(), { output: "full.mp4" });
    const one = compile(sample(), { output: "one.mp4", scene: "middle" });

    const fullT = full.args[full.args.indexOf("-t") + 1];
    const oneT = one.args[one.args.indexOf("-t") + 1];
    expect(Number(oneT)).toBe(3);
    expect(Number(fullT)).toBeGreaterThan(Number(oneT));
    // No xfade survives — only one scene is compiled.
    expect(one.filtergraph ?? "").not.toContain("xfade");
  });

  test("unknown scene ids list what is available", () => {
    expect(() => selectScene(normalizeComposition(sample()), "nope")).toThrow(/intro, middle, outro/);
  });
});

describe("parseRenderArgs", () => {
  test("parses the common flags", () => {
    const parsed = parseRenderArgs(["scene.ts", "-o", "out.mp4", "--preview", "--scene", "intro"]);
    expect(parsed.input).toBe("scene.ts");
    expect(parsed.options.output).toBe("out.mp4");
    expect(parsed.options.preview).toBe(144);
    expect(parsed.options.scene).toBe("intro");
    expect(parsed.dryRun).toBe(false);
  });

  test("--preview takes an optional height", () => {
    expect(parseRenderArgs(["--preview"]).options.preview).toBe(144);
    expect(parseRenderArgs(["--preview", "480"]).options.preview).toBe(480);
    expect(parseRenderArgs(["--preview=360"]).options.preview).toBe(360);
  });

  test("--preview followed by the input does not eat it", () => {
    const parsed = parseRenderArgs(["--preview", "scene.ts"]);
    expect(parsed.options.preview).toBe(144);
    expect(parsed.input).toBe("scene.ts");
  });

  test("defaults output when omitted", () => {
    expect(parseRenderArgs([]).options.output).toBe("./out.mp4");
  });

  test("collects boolean and value flags", () => {
    const parsed = parseRenderArgs([
      "--gpu",
      "--verbose",
      "--dry-run",
      "--ytdlp",
      "--ytdlp-cookies",
      "c.txt",
      "--no-asset-cache",
      "--asset-cache-dir",
      "cache",
    ]);
    expect(parsed.options.encoder).toBe("auto");
    expect(parsed.options.verbose).toBe(true);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.options.ytdlp).toBe(true);
    expect(parsed.options.ytdlpCookies).toBe("c.txt");
    expect(parsed.options.assetCache).toBe(false);
    expect(parsed.options.assetCacheDir).toBe("cache");
  });

  test("ignores unknown flags instead of throwing", () => {
    const parsed = parseRenderArgs(["--my-own-flag", "scene.ts", "--other"]);
    expect(parsed.input).toBe("scene.ts");
  });

  test("rejects a non-numeric --preview=", () => {
    expect(() => parseRenderArgs(["--preview=big"])).toThrow(/height in pixels/);
  });
});

describe("text colour shorthand", () => {
  test("#rgb expands and @alpha survives", () => {
    const { filtergraph } = compile(
      composition({ width: 320, height: 180 })
        .scene({ duration: 1 }, (s) =>
          s.text("hex", { fontSize: 20, color: "#fff", box: true, boxColor: "#000@0.6" })
        )
        .build(),
      { output: "hex.mp4" }
    );
    expect(filtergraph).toContain("fontcolor=0xffffff");
    expect(filtergraph).toContain("boxcolor=0x000000@0.6");
  });
});
