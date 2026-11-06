# 004 — CI check on push/PR

**Status:** open
**Created:** 2026-11-06

## Problem

`publish.yml` verifies the bundled FFmpeg binary and runs tests, but it only
triggers on `v*` tags. A broken upstream asset (see `tickets/003`) therefore
survives until release day, when publishing fails.

## Proposal

Add `.github/workflows/ci.yml` triggered on `push` to `main` and on
`pull_request`:

1. Checkout, pnpm, Node 24
2. Restore `vendor/` cache
3. `pnpm install --frozen-lockfile`
4. Verify drawtext:
   ```
   node scripts/install-ffmpeg.mjs --print-path > /tmp/ff
   "$(cat /tmp/ff)" -filters | grep -q drawtext
   ```
5. `pnpm test`
6. `pnpm typecheck`
7. `pnpm exec tsup`

Keep it separate from `publish.yml` so release stays lean.

## Open questions

- Should it also render one short composition as a smoke test? That adds minutes
  per run but catches real render regressions, not just install problems.
- Cache strategy: same keys as `telegram-render.yml` so both workflows share
  entries.
