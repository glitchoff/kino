# Code compositions

Author a composition in TypeScript instead of JSON. The builder emits a plain
`KinoComposition`, so code and JSON stay interchangeable.

## Shape

```ts
import { composition, fadeIn, render } from "@glitchoff/kino";

const comp = composition({ width: 1080, height: 1920, fps: 30 })
  .audio({ src: "https://…/bed.mp3", volume: 0.8, fadeIn: 2, fadeOut: 3 })
  .scene({ duration: 10, background: "#0f172a", transition: "fade" }, (s) =>
    s
      .text("The Blue Marble", {
        fontSize: 84,
        color: "#fff",
        x: "center",
        y: "(h-text_h)/2-400",
        startAt: 1,
        duration: 8,
        animation: { opacity: fadeIn(0.6) },
      })
      .image("https://images.unsplash.com/…", { width: 640, x: "center", startAt: 2 })
  )
  .build();

await render(comp, { output: "out.mp4" });
```

## What the builder gives you

| API | Notes |
| --- | --- |
| `composition(options)` | `width`, `height`, `fps`, `audio`, `templates` |
| `.scene(options, cb?)` | `id`, `duration`, `background`, `transition` |
| `.addScene()` / `.addScenes()` | append raw `KinoScene` objects |
| `.audio()` / `.template()` | composition-level settings |
| `.build()` | returns `KinoComposition` |

Inside a scene callback: `.text()`, `.image()`, `.video()`, `.html()`, `.add()`,
`.addAll()`.

Standalone element factories (`text()`, `image()`, `video()`, `html()`) can be
used without a builder — useful with `.map()`:

```ts
const cards = items.map((item) =>
  text(item.title, { fontSize: 48, x: "center", y: `(h-text_h)/2+${item.slot * 120}` })
);
builder.scene({ duration: 6 }, (s) => s.addAll(cards));
```

Animation helpers: `animate({ from, to, duration, easing })`, `fadeIn()`,
`fadeOut()`, `slideIn()`, `popIn()`.

## Timing from narration

`tts()` is lazy (render-time synthesis), so it cannot report a length. Use
`await voice()` when the timing depends on the words:

```ts
const line = await voice("Where the mind is without fear.", { voice: "en_US-lessac-medium" });
line.seconds; // 1.63

comp.scene({ duration: { fit: line } }, (s) => s.text("…").say(line));
comp.scene({ duration: line.seconds + 2 }, (s) => s.say(line)); // same audio, reused
```

`fit` = speech + `pad` (0.6s), plus optional `lead` and `min`. Fits are resolved
in `normalizeComposition()` before validation, so everything downstream sees a
number. Measuring is cached, so parallel `Promise.all` over many lines is cheap.
See `examples/narration-fit.ts` and `tickets/008`.

Plain objects can be typed with `defineComposition({ ... })`; `toComposition()`
normalises a builder or object into a `KinoComposition`.

## CLI

```bash
node dist/cli.js examples/basic.ts -o out/basic.mp4
node dist/cli.js examples/basic.ts --dry-run
```

A module may `export default` a composition, a builder, or a function returning
either; named `composition` / `scene` exports also work.

## Option aliases

Options mirror the composition fields, with a few friendlier aliases:

| Builder option | Composition field |
| --- | --- |
| `color` | `fontColor` |
| `align` | `textAlign` |

Unset options are omitted entirely, so the emitted object is clean.

## JSON status

JSON is the legacy/interop format. It is still accepted everywhere and is not
being removed, but it is frozen — new features land in the builder first.

## Why not JSX / a reactive DSL

Deferred on purpose — see `deferred.md`. Keeping the output a plain object means
there is one composition model, not two.
