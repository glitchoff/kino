/**
 * Scenes as values.
 *
 * A scene can be held in a variable, reused and merged, which the chained
 * builder cannot express: `.scene()` appends to a composition and returns the
 * composition, so there is never a moment where the scene has a name.
 *
 * Here the chorus is written once and plays twice.
 *
 *   npx kino examples/scene-values.ts -o out/scene-values.mp4
 */
import { merge, render, scene, text } from "@glitchoff/kino";

const W = 1920;
const H = 1080;

/** A title card, sized to its own content. */
const card = (heading: string, sub: string, bg: string) =>
  scene({ for: 3, bg }, [
    text(heading, { fontSize: 96, color: "#ffffff", x: "center", y: "center-60" }),
    text(sub, { fontSize: 36, color: "#94a3b8", x: "center", y: "center+70" }),
  ]);

const intro = card("Kino", "scenes are values", "#0f172a");

// Written once. Merged twice. It is the same object both times, so editing
// this line changes both appearances.
const chorus = scene({ for: 2, bg: "#1e293b", transition: { type: "fade", duration: 0.5 } }, [
  text("merge(intro, chorus, chorus)", { fontSize: 52, color: "#38bdf8", x: "center", y: "center" }),
]);

const outro = scene({ for: 2.5, bg: "#0f172a", transition: { type: "fade", duration: 0.5 } }, [
  text("done", { fontSize: 72, color: "#ffffff", x: "center", y: "center" }),
]);

// One composition, built by joining values rather than by chaining calls.
const video = {
  width: W,
  height: H,
  fps: 30,
  ...merge(intro, chorus, chorus, outro),
};

export default video;

if (import.meta.url === `file://${process.argv[1]}`) {
  await render(video, { output: "out/scene-values.mp4" });
}
