# Code compositions

Author a composition in TypeScript instead of JSON. The builder emits a plain
`KinoComposition`, so code and JSON stay interchangeable.

> Status: in progress — see `tickets/001`. The builder exists in
> `src/builder/index.ts`; CLI support for `.ts`/`.js` input is not wired yet.

## Shape

```ts
import { composition, text, image, animate, fadeIn, render } from "@glitchoff/kino";

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

## Option aliases

Options mirror the JSON field names, with a few friendlier aliases:

| Builder option | JSON field |
| --- | --- |
| `color` | `fontColor` |
| `align` | `textAlign` |
| `fit` | `fit` |
| `startAt` | `startAt` |

`undefined` options are omitted entirely, so the emitted object is clean.

## Why not JSX / a reactive DSL

Deferred on purpose — see `deferred.md`. Keeping the output a plain object means
there is one composition model, not two.
