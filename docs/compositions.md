# Compositions

A composition holds scenes. Scenes play in order, own their background and
timing, and contain elements. Elements are positioned in frame coordinates and
start at `startAt` seconds relative to their scene.

## Scenes as values

`scene()` returns a scene you can hold in a variable, reuse and merge. This is
the shortest way to write a composition, and the only way to reuse one scene
several times:

```typescript
import { merge, render, scene, text } from "@glitchoff/kino";

const intro = scene({ for: 5, bg: "#0f172a" }, [
  text("The Blue Marble", { fontSize: 84, color: "#fff", x: "center", y: "center" }),
]);

// Written once, played twice — it is the same object both times.
const chorus = scene({ for: 4, bg: "#111827", transition: "fade" }, [
  text("Fin.", { fontSize: 72, color: "#94a3b8", x: "center", y: "center" }),
]);

const video = merge(intro, chorus, chorus, intro);

await render(video, { output: "./out.mp4" });
```

| Call | Purpose |
| --- | --- |
| `scene({ for, bg, transition, id }, elements?)` | One scene, as a value |
| `merge(...parts)` | Join scenes into a composition |

`scene()` produces exactly the object the builder produces, so the two mix
freely. `for` is the scene length and takes everything `duration` takes,
including `{ fit: voice }`.

`merge()` flattens whatever it is given — scenes, compositions, builders, or
arrays of any of them — so joining two finished videos is the same call as
joining two scenes:

```typescript
merge(partOne, partTwo);          // two compositions
merge([a, b], scene({ for: 1 })); // arrays and single scenes
```

Canvas, audio and templates come from the first composition passed; everything
after it contributes scenes only. A merged composition compiles to the same
filtergraph as the equivalent builder chain.

:::preview name="feature-scene-values" caption="one chorus scene, merged twice"
:::

## The builder

The builder chains scenes onto a composition in place. It reads well for a
single composition written top to bottom; reach for `scene()` when a scene
needs a name.

```typescript
import { composition } from "@glitchoff/kino";

const video = composition({ width: 1080, height: 1920 })
  .scene({ duration: 5, background: "#0f172a" }, (s) =>
    s
      .text("The Blue Marble", { fontSize: 84, color: "#fff", x: "center", y: "(h-text_h)/2-400" })
      .image("./earth.jpg", { width: 640, x: "center", startAt: 2 })
  )
  // A transition belongs to the scene arriving, so the first scene cannot have
  // one — hence the separate second scene here.
  .scene({ duration: 4, background: "#111827", transition: { type: "fade", duration: 0.6 } }, (s) =>
    s.text("Fin.", { fontSize: 72, color: "#94a3b8", x: "center", y: "center" })
  )
  .build();
```

| Call | Purpose |
| --- | --- |
| `composition({ width, height, fps, audio, templates })` | Start a composition |
| `.scene({ id, duration, background, transition }, cb?)` | Add a scene |
| `.addScene(scene)` / `.addScenes(scenes)` | Append raw scene objects |
| `.audio(tracks)` / `.template(t)` | Composition-level settings |
| `.build()` | Produce a `KinoComposition` |

Inside a scene callback: `.text()`, `.image()`, `.video()`, `.html()`, `.tak()`,
`.add()`, `.addAll()`.

## Standalone element helpers

Useful with `map`/`filter` when the content is generated:

```typescript
import { composition, text } from "@glitchoff/kino";

const titles = ["One", "Two", "Three"];

composition({ width: 1080, height: 1920 })
  .scene({ duration: 3 * titles.length, background: "#000" }, (s) =>
    s.addAll(
      titles.map((title, i) =>
        text(title, { fontSize: 96, color: "#fff", x: "center", y: "center", startAt: i * 3, duration: 3 })
      )
    )
  );
```

## Reusable pieces

`scene()` makes a scene a value. The rest of the same idea is here — a look, an
element, a group of elements, and a set of scenes can all be named and reused.

| Call | What it does |
| --- | --- |
| `preset(...layers)` | Merge option sets, nesting groups key by key |
| `withDefaults(factory, defaults)` | Derive a factory from a look |
| `withOptions(element, options)` | Dress an element after it was made |
| `elements(...parts)` | Flatten elements, groups and lazy factories into one list |
| `shift(animation, by)` | Move an animation in time |
| `repeat(scene, times)` | Play a scene again, optionally with a gap |
| `variants(props, entries)` | Several scenes sharing their props |

```typescript
import { elements, fadeIn, merge, preset, repeat, scene, shift, text, variants, withDefaults, withOptions } from "@glitchoff/kino";

// A look, built up in layers. Nested groups merge, so `stroke` survives —
// `withDefaults` alone replaces it wholesale.
const Heading = withDefaults(text, preset({
  fontSize: 84, color: "#ffffff", x: "center",
  stroke: { color: "#0f172a", width: 6 },
}));

// A group of elements, passed around as one value.
const card = (heading: string, note: string) => elements(
  Heading(heading, { y: "center-50", animation: fadeIn(0.4) }),
  withOptions(text(note, { fontSize: 30 }), {
    color: "#94a3b8", x: "center", y: "center+60",
    animation: shift(fadeIn(0.4), 0.25),   // starts a beat later
  }),
);

// One background and length, several scenes.
const [intro, chorus, outro] = variants({ for: 2.5, bg: "#0f172a" }, [
  { id: "intro", elements: card("Kino", "reusable pieces") },
  { id: "chorus", elements: card("again", "repeat(scene, 2)"), transition: "fade" },
  { id: "outro", elements: card("done", "merge() them all"), transition: "fade" },
]);

const video = merge(intro, repeat(chorus, 2), outro);
```

`repeat` shares the scene object rather than copying it, so editing `chorus`
changes both appearances. `{ times: 2, gap: 1 }` lengthens the scene instead of
inserting a gap scene, so its background holds through the pause rather than
flashing black. A scene sized to narration is left alone.

`elements()` calls any factory it is given once, at flatten time, so a component
that needs work to build is only built when it is used.

:::preview name="feature-reusable" caption="a preset look, a group, a repeated scene"
:::

### Deriving from a factory

`withDefaults` is the older form and still the shortest for a single look:

```typescript
import { composition, text, withDefaults, SceneBuilder } from "@glitchoff/kino";

const Title = withDefaults(text, {
  fontSize: 96, color: "#fff", x: "center", y: "center",
});
Title("Hello");                          // defaults
Title("Hello", { color: "#38bdf8" });    // per-call options win

// A scene callback: same scene, different data.
const titleCard = (heading: string) => (s: SceneBuilder) => s.add(Title(heading));

// A generator: one scene per item.
function* credits(names: string[]) {
  for (const name of names) yield (s: SceneBuilder) => s.text(name, { y: "center" });
}
```

`withDefaults` merges one level deep — passing `stroke` replaces a default
`stroke` entirely rather than merging its keys. Defaults are never mutated, so
the same derived factory can be reused freely. Use `preset()` when a look is
built in layers.

See `examples/reusable-components.ts` and `examples/reusable-pieces.ts` for
runnable versions.

## Plain objects

Everything the builder produces is a plain `KinoComposition`, so object literals
work anywhere a builder does. This is the same video written directly:

```typescript
import { render } from "@glitchoff/kino";

await render(
  {
    width: 1080, height: 1080, fps: 30,
    scenes: [{
      duration: 3,
      background: "#111",
      elements: [{ type: "text", content: "Hi", fontSize: 72, x: "center", y: "center" }],
    }],
  },
  { output: "out.mp4" }
);
```

---
---

Next: [Content](./content.md) covers what goes inside a scene.
