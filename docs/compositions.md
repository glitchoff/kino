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

## Reusable components

A component is a function or a `SceneBuilder` — there is no separate component
model. Four patterns cover most reuse:

```typescript
import { composition, text, withDefaults, SceneBuilder } from "@glitchoff/kino";

// 1. A derived factory: define the look once, override per use.
const Title = withDefaults(text, {
  fontSize: 96, color: "#fff", x: "center", y: "center",
});
Title("Hello");                          // defaults
Title("Hello", { color: "#38bdf8" });    // per-call options win

// 2. A scene callback: same scene, different data.
const titleCard = (heading: string) => (s: SceneBuilder) => s.add(Title(heading));

// 3. A pre-built scene: `.scene()` accepts a KinoScene or SceneBuilder directly.
const lowerThird = (name: string) =>
  new SceneBuilder({ duration: 3 }).text(name, { x: 80, y: "bottom-140" });

composition({ width: 1080, height: 1920 })
  .scene({ duration: 3 }, titleCard("Intro"))
  .scene({ duration: 2 }, titleCard("Outro"))
  .scene(lowerThird("Alice").build());

// 4. A generator: one scene per item.
function* credits(names: string[]) {
  for (const name of names) yield (s: SceneBuilder) => s.text(name, { y: "center" });
}
```

`withDefaults` merges one level deep — passing `stroke` replaces a default
`stroke` entirely rather than merging its keys. Defaults are never mutated, so
the same derived factory can be reused freely.

See `examples/reusable-components.ts` for a runnable version.

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
