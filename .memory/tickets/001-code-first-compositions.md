# 001 — Scripting-first compositions

**Status:** done
**Started:** 2026-11-06

## Goal

Author compositions in TypeScript instead of JSON, without introducing a second
composition model. The builder produces a plain `KinoComposition`, so JSON and
code are interchangeable.

## Shipped

1. `src/builder/index.ts` — `composition()`, `CompositionBuilder`, `SceneBuilder`,
   element factories (`text`, `image`, `video`, `html`), animation helpers
   (`animate`, `fadeIn`, `fadeOut`, `slideIn`, `popIn`), plus `defineComposition()`
   and `toComposition()`.
2. Exported from `src/index.ts`.
3. CLI accepts `.ts`, `.mts`, `.js`, `.mjs` alongside `.json` and `.kino`.
   A module may `export default` a composition, a builder, or a function that
   returns either; named `composition` / `scene` exports also work.
4. `examples/basic.ts` — the JSON example ported to code; renders identically.
5. Docs: README, `docs/index.md`, `docs/getting-started.md` (new Code
   Compositions section), `docs/api-reference.md` (builder reference),
   `docs/schema-reference.md` (reframed as the data shape).
6. Tests: `test/builder.test.ts` — 16 cases, including a JSON-equivalence check.

## Design notes

- Element factories return `TextElement` / `ImageElement` / … directly, so they
  can be used standalone, in `.map()`, or through the scene builder.
- Options mirror the composition fields where practical, with friendly aliases
  (`color` → `fontColor`, `align` → `textAlign`).
- Unset options are omitted rather than written as `undefined`, so the emitted
  object is clean, JSON-safe data.
- The builder does not validate; validation stays in `src/validate/`.

## Outcome

Kino is now scripting-first. JSON is the legacy/interop format: still accepted
everywhere and frozen, with new features landing in the builder first.

