# 004 — CI check on push/PR

**Status:** done (2026-11-06)
**Created:** 2026-11-06

## Problem

`publish.yml` verifies the bundled FFmpeg binary and runs tests, but it only
triggers on `v*` tags. A broken upstream asset (see `tickets/003`) therefore
survives until release day, when publishing fails. Nothing else gated `main`,
so a broken push — stale examples, a type error — reached the repo unchecked.

## Shipped

`.github/workflows/ci.yml`, triggered on `push` to `main`, on `pull_request`,
and manually. Steps:

1. Checkout, pnpm 10.30.3, Node 24
2. Restore `vendor/` and `node_modules` caches (same keys as
   `telegram-render.yml`, so both workflows share entries)
3. `pnpm install --frozen-lockfile --prefer-offline`
4. `pnpm typecheck`
5. `pnpm exec tsup`
6. `pnpm test`
7. Every `examples/*.ts` compiles via `--dry-run`
8. Verify the bundled Linux ffmpeg has `drawtext`

`concurrency` cancels superseded runs on the same ref.

## First run caught a real bug

The workflow's very first run failed with:

```
Error: Failed to resolve entry for package "@glitchoff/kino".
```

`test/timeline.test.ts` imports `../examples/all-transitions.js`, and the example
imports `@glitchoff/kino`, which resolves through `dist/` (the package's own
`exports` map). With the build step after the tests, `dist/` did not exist yet
and the import failed. Locally it passed only because `dist/` was already built
from an earlier run — a stale-artifact false pass.

**Fix:** build before test. Order is now typecheck → build → test → examples.
Reproduced from a clean tree (`rm -rf dist`): 1 failed / 84 passed, then 85/85
once the build runs first.

## Decisions

- **No render smoke test.** A real render adds minutes per run and the manual
  `telegram-render.yml` already covers "does it actually render" on demand.
  `--dry-run` on all 11 examples catches the realistic failure (a broken or
  stale example) in seconds.
- **Separate from `publish.yml`** so release stays lean and tag runs are not
  blocked by unrelated CI churn.
- **Ordering matters:** `tsup` runs before the example loop because the CLI
  loads examples through `dist/`. Typecheck and tests run first so a type error
  fails fast, before the build.

## Why this existed in the first place

`examples/*.ts` were converted from JSON and silently went stale — the CLI
failed with `text(...).text is not a function` for most of them until the
converter was fixed. Step 7 is the direct guard against that recurring.

## Verified locally

All seven steps run clean on `2108a60`: typecheck ok, 85 tests, build ok, 11/11
examples compile.
