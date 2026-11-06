/**
 * Reusable components.
 *
 * A component is just a function or a `SceneBuilder` — no new model. These
 * patterns are the reason to script a composition instead of writing JSON.
 *
 *   npx kino examples/reusable-components.ts -o out.mp4
 *   npx kino examples/reusable-components.ts --scene lower-third --preview
 */
import {
  composition,
  SceneBuilder,
  text,
  withDefaults,
  fadeIn,
  type SceneBuilder as SceneBuilderType,
} from "@glitchoff/kino";

// ---------------------------------------------------------------------------
// 1. A derived factory: define the look once, override per use
// ---------------------------------------------------------------------------

const Title = withDefaults(text, {
  fontSize: 96,
  color: "#ffffff",
  x: "center",
  y: "center",
  stroke: { color: "#0f172a", width: 6 },
});

const Caption = withDefaults(text, {
  fontSize: 36,
  color: "#94a3b8",
  x: "center",
  y: "center+90",
});

// ---------------------------------------------------------------------------
// 2. A scene callback: the same scene, different data
// ---------------------------------------------------------------------------

const titleCard = (heading: string, sub: string) => (s: SceneBuilderType) =>
  s.add(Title(heading, { animation: fadeIn(0.4) })).add(Caption(sub));

// ---------------------------------------------------------------------------
// 3. A pre-built scene object: reusable as-is, added with .scene(scene)
// ---------------------------------------------------------------------------

const lowerThird = (name: string, role: string) =>
  new SceneBuilder({ id: "lower-third", duration: 3, background: "#0f172a" })
    .text(name, { x: 80, y: "bottom-140", fontSize: 52, color: "#ffffff" })
    .text(role, { x: 80, y: "bottom-90", fontSize: 30, color: "#38bdf8" });

// ---------------------------------------------------------------------------
// 4. A generator: one scene per item, no array needed up front
// ---------------------------------------------------------------------------

function* credits(names: string[]): Generator<(s: SceneBuilderType) => void> {
  for (const name of names) {
    yield (s) => s.add(Caption(name, { y: "center" }));
  }
}

const comp = composition({ width: 1080, height: 1920, fps: 30 })
  .scene({ duration: 3, background: "#0f172a" }, titleCard("Kino", "scripting-first video"))
  // The same callback again, with different data.
  .scene({ duration: 2, background: "#1e293b" }, titleCard("Reusable", "components, not JSON"));

for (const scene of credits(["Directed by", "Someone", "Edited by", "Someone else"])) {
  comp.scene({ duration: 1.5, background: "#0f172a" }, scene);
}

// A pre-built scene, used directly — no callback needed.
comp.scene(lowerThird("Alice", "Presenter").build());

export default comp.build();
