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

  test("composites at the preview size instead of downscaling at the end", () => {
    const { filtergraph, args } = compile(sample(), { output: "preview.mp4", preview: true });
    expect(filtergraph).toBeDefined();
    // The old contract appended `scale=-2:H[vpv]` after every scene. That did
    // full-size work and threw it away, so it is gone.
    expect(filtergraph).not.toContain("[vpv]");
    expect(filtergraph).not.toMatch(/scale=-2:\d+/);
    // The frame is built small: the background source is 1080x1920 at 144p.
    expect(args.join(" ")).toContain("s=82x144");
  });

  test("honours an explicit preview height", () => {
    const { args } = compile(sample(), { output: "preview.mp4", preview: 360 });
    // 1080x1920 at 360p is 202x360.
    expect(args.join(" ")).toContain("s=202x360");
  });

  test("encodes previews with ultrafast unless a preset is given", () => {
    const fast = compile(sample(), { output: "p.mp4", preview: true });
    expect(fast.args.join(" ")).toContain("-preset ultrafast");

    const explicit = compile(sample(), { output: "p.mp4", preview: true, preset: "slow" });
    expect(explicit.args.join(" ")).toContain("-preset slow");
  });

  test("a full render is built at full size", () => {
    const full = compile(sample(), { output: "full.mp4" });
    expect(full.args.join(" ")).toContain("s=1080x1920");
    expect(full.args.join(" ")).not.toContain("s=82x144");
    expect(full.args.join(" ")).not.toContain("-preset ultrafast");
  });

  test("preview keeps the same elements and timing, only a smaller frame", () => {
    const full = compile(sample(), { output: "full.mp4" });
    const preview = compile(sample(), { output: "preview.mp4", preview: true });

    // Same number of overlays and drawtexts: nothing is dropped or reordered.
    const count = (g: string, re: RegExp) => (g.match(re) ?? []).length;
    expect(count(preview.filtergraph!, /overlay=/g)).toBe(count(full.filtergraph!, /overlay=/g));
    expect(count(preview.filtergraph!, /drawtext=/g)).toBe(count(full.filtergraph!, /drawtext=/g));
    // Same duration either way.
    const t = (args: string[]) => args[args.indexOf("-t") + 1];
    expect(t(preview.args)).toBe(t(full.args));
  });

  test("scales text with the frame so it does not overflow a preview", () => {
    const full = compile(sample(), { output: "full.mp4" });
    const preview = compile(sample(), { output: "preview.mp4", preview: true });
    // Animated text emits `fontsize='N'` (quoted), static text emits
    // `fontsize=N`, so the pattern has to allow the quotes.
    const fs = (g: string) => Number(g.match(/fontsize='?(\d+)'?/)?.[1]);
    // sample() draws at 72; at 144/1920 the preview is ~5.
    expect(fs(full.filtergraph!)).toBe(72);
    expect(fs(preview.filtergraph!)).toBeGreaterThan(0);
    expect(fs(preview.filtergraph!)).toBeLessThan(10);
  });
});
