# 007 — Reusable components

**Status:** done (withDefaults + .scene(scene); no new model)
**Created:** 2026-11-06

## Goal

Make it natural to define a piece of video once — a lower third, a title card, a
credits roll — and reuse it with different data. This is the thing JSON
structurally cannot do, so it is the clearest justification for scripting-first.

## What already works

Functions are enough for most cases, because a scene callback is just a function.

```ts
const title = (t: string, size = 84) =>
  text(t, { fontSize: size, color: "#ffffff", x: "center", y: "center" });

const intro = (s: SceneBuilder) => s.add(title("Intro")).text("subtitle", { y: "center+80" });

composition({ width: 1080, height: 1920 })
  .scene({ duration: 3 }, intro)
  .scene({ duration: 3 }, intro);
```

Generators work too:

```ts
function* slides(items: string[]) {
  for (const item of items) yield (s: SceneBuilder) => s.text(item, { x: "center", y: "center" });
}

const comp = composition({ width: 1080, height: 1920 });
for (const scene of slides(["One", "Two", "Three"])) comp.scene({ duration: 2 }, scene);
```

Verified: two reused callbacks plus two reused pre-built scenes produce 4 scenes
with 1 element each.

## Gaps

| Gap | Consequence |
| --- | --- |
| `SceneBuilder` is not exported | A scene can only be built inline, not held in a variable and reused as an object |
| `s.add()` takes a single raw element | No way to add an array of pre-built elements |
| No variant helper | Deriving "title, but red" means spreading options by hand |
| Element factories return plain objects | Fine, but there is no `withDefaults()` sugar |

## Proposal

Two small primitives, not a new model. Both stay on plain `KinoComposition`.

### 1. `withDefaults(factory, defaults)`

```ts
const Title = withDefaults(text, {
  fontSize: 84,
  color: "#ffffff",
  x: "center",
  y: "center",
});

Title("Hello");                    // same as text("Hello", { ...defaults })
Title("Hello", { color: "#38bdf8" });  // per-call overrides win
```

Works for `text`, `image`, `video`, `html` — anything with an options argument.
Implementation is a typed wrapper, ~15 lines.

### 2. Export `SceneBuilder`

```ts
import { SceneBuilder } from "@glitchoff/kino";

const lowerThird = (name: string) =>
  new SceneBuilder({ duration: 3 })
    .text(name, { x: 60, y: "bottom-80", fontSize: 36 })
    .text("KINO", { x: 60, y: "bottom-40", fontSize: 24 });

comp.addScene(lowerThird("Alice").build());
```

Today this is already possible via `addScene`, but `SceneBuilder` is not exported
from the package root, so it is effectively private.

## Explicitly out of scope

- **No JSX/DSL.** Deferred in `deferred.md`; the builder stays plain functions.
- **No reactive scene graph.** Values are computed at build time.
- **No component registry.** Composition-local functions are simpler and type
  better than a string-keyed registry.

## Open questions (resolved)

- **`.scene()` accepting a pre-built scene — done.** Overloads accept
  `SceneOptions`, `KinoScene` or `SceneBuilder`. Detection is `"elements" in input`,
  so options and scene objects can't be confused.
- **Deep vs shallow merge — shallow, deliberately.** Passing `stroke` replaces
  a default `stroke` wholesale. Deep merge would make "remove a default" or
  "replace a nested object" ambiguous; one level is predictable and is all the
  examples need.

## What shipped

- `withDefaults(factory, defaults)` — generic over the factory, so it works for
  `text`, `image`, `video`, `html` with full inference. Never mutates defaults.
- `.scene()` accepts a `KinoScene` or `SceneBuilder` directly.
- `SceneBuilder` and `SceneInput` exported from the package root (SceneBuilder
  was already re-exported; `SceneInput` is new).
- `examples/reusable-components.ts` — all four patterns in one runnable file.
- Docs: "Reusable components" section in `docs/getting-started.md`.
- Tests: +8 in `test/builder.test.ts` (defaults, override precedence, no
  mutation, all four factories, scene reuse, filtergraph check).
