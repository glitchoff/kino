import { describe, test, expect } from "vitest";
import { compile } from "../src/pipeline/index.js";
import { PREVIEW_DEFAULT_HEIGHT, resolvePreviewHeight } from "../src/types/index.js";
import { composition, fadeIn } from "../src/builder/index.js";

function sample() {
  return composition({ width: 1080, height: 1920, fps: 30 })
    .scene({ duration: 2, background: "#0f172a" }, (s) =>
      s.text("Preview", { fontSize: 72, x: "center", y: "center", animation: { opacity: fadeIn(0.4) } })
    )
    .scene({ id: "second", duration: 2, transition: { type: "fade", duration: 0.5 } }, (s) =>
      s.text("Second", { x: "center", y: "center" })
    )
    .build();
}

describe("preview mode", () => {
  test("resolvePreviewHeight maps flags to a pixel height", () => {
    expect(resolvePreviewHeight(undefined)).toBeUndefined();
    expect(resolvePreviewHeight(false)).toBeUndefined();
    expect(resolvePreviewHeight(true)).toBe(PREVIEW_DEFAULT_HEIGHT);
    expect(resolvePreviewHeight(480)).toBe(480);
    expect(resolvePreviewHeight(143.6)).toBe(144);
    expect(resolvePreviewHeight(1)).toBe(16);
  });

  test("appends a final downscale to the filtergraph and maps it", () => {
    const { filtergraph, args } = compile(sample(), { output: "preview.mp4", preview: true });
    expect(filtergraph).toBeDefined();
    expect(filtergraph).toContain(`scale=-2:${PREVIEW_DEFAULT_HEIGHT}[vpv]`);
    // The downscale must be the last video stage, not a mid-graph filter.
    expect(filtergraph!.trimEnd().endsWith("[vpv]")).toBe(true);
    const mapIdx = args.indexOf("-map");
    expect(args[mapIdx + 1]).toBe("[vpv]");
  });

  test("honours an explicit preview height", () => {
    const { filtergraph } = compile(sample(), { output: "preview.mp4", preview: 360 });
    expect(filtergraph).toContain("scale=-2:360[vpv]");
  });

  test("encodes previews with ultrafast unless a preset is given", () => {
    const fast = compile(sample(), { output: "p.mp4", preview: true });
    expect(fast.args.join(" ")).toContain("-preset ultrafast");

    const explicit = compile(sample(), { output: "p.mp4", preview: true, preset: "slow" });
    expect(explicit.args.join(" ")).toContain("-preset slow");
  });

  test("leaves the scene graph untouched when preview is off", () => {
    const full = compile(sample(), { output: "full.mp4" });
    const preview = compile(sample(), { output: "preview.mp4", preview: true });

    // Preview only adds the output stage — nothing before it changes.
    expect(preview.filtergraph!.startsWith(full.filtergraph!)).toBe(true);
    expect(full.filtergraph).not.toContain("[vpv]");
    expect(full.args.join(" ")).not.toContain("-preset ultrafast");
  });
});
