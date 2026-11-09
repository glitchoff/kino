/**
 * Reusable pieces.
 *
 * `scene()` made a scene a value. These are the rest of the same idea: a look
 * is a preset, an element can be dressed after the fact, a group of elements is
 * one argument, a scene can be repeated, and a set of scenes can share props.
 *
 *   npx kino examples/reusable-pieces.ts -o out/reusable-pieces.mp4
 */
import {
  elements,
  fadeIn,
  merge,
  preset,
  render,
  repeat,
  scene,
  shift,
  text,
  variants,
  withDefaults,
  withOptions,
} from "@glitchoff/kino";

// A look, built up in layers. Nested groups merge, so `stroke` survives.
const dark = preset({
  fontSize: 84,
  color: "#ffffff",
  x: "center",
  stroke: { color: "#0f172a", width: 6 },
});

const Heading = withDefaults(text, dark);
const Note = withDefaults(text, preset({ fontSize: 30, color: "#94a3b8", x: "center" }));

// A group of elements, passed around as one value.
const withNote = (heading: string, note: string) =>
  elements(
    Heading(heading, { y: "center-50", animation: fadeIn(0.4) }),
    withOptions(Note(note), { y: "center+60", animation: shift(fadeIn(0.4), 0.25) })
  );

// One background, several scenes — written once, varied per entry.
const [intro, chorus, outro] = variants({ for: 2.5, bg: "#0f172a" }, [
  { id: "intro", elements: withNote("Kino", "reusable pieces") },
  { id: "chorus", elements: withNote("again", "repeat(scene, 2)"), transition: { type: "fade", duration: 0.4 } },
  { id: "outro", elements: withNote("done", "merge() them all"), transition: { type: "fade", duration: 0.4 } },
]);

const video = {
  width: 1920,
  height: 1080,
  fps: 30,
  ...merge(intro, repeat(chorus, 2), outro),
};

export default video;

if (import.meta.url === `file://${process.argv[1]}`) {
  await render(video, { output: "out/reusable-pieces.mp4" });
}
