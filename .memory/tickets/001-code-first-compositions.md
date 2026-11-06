# 001 — Code-first compositions

**Status:** in-progress
**Started:** 2026-11-06

## Goal

Author compositions in TypeScript instead of JSON, without introducing a second
composition model. The builder produces a plain `KinoComposition`, so JSON and
code are interchangeable.

## Plan

1. `src/builder/index.ts` — `composition()`, `SceneBuilder`, element factories
   (`text`, `image`, `video`, `html`) and animation helpers (`animate`,
   `fadeIn`, `fadeOut`, `slideIn`, `popIn`). **Done, needs verification.**
2. Export the builder from `src/index.ts`.
3. CLI: accept `.ts` / `.js` composition modules in addition to `.json`.
   - `.json` → `JSON.parse`
   - `.js` → dynamic `import()`
   - `.ts` → dynamic `import()` under a loader (`tsx` is already a devDependency;
     needs a runtime strategy that works for published installs)
4. Example: port one existing JSON example to code and keep both.
5. Docs: a section in `docs/getting-started.md` plus a guide entry.

## Design notes

- Element factories return `TextElement` / `ImageElement` / … directly, so they
  can be used standalone, in `.map()`, or through the scene builder.
- Options objects mirror the JSON field names where practical, but use friendlier
  aliases (`color` → `fontColor`, `align` → `textAlign`) since there is no schema
  to memorise.
- `undefined` options are omitted from the output rather than written as
  `undefined`, so the emitted object is clean JSON.
- The builder must not validate; validation stays in `src/validate/`.

## Open questions

- Should `.ts` support require the user to have `tsx` installed, or should the
  CLI bundle a transpiler? Bundling adds weight to every install.
- Do we want a `defineComposition()` helper purely for type inference on plain
  object literals (no builder)? Cheap to add.
