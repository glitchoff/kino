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
5. `pnpm test`
6. `pnpm exec tsup`
7. Every `examples/*.ts` compiles via `--dry-run`
8. Verify the bundled Linux ffmpeg has `drawtext`

`concurrency` cancels superseded runs on the same ref.

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
