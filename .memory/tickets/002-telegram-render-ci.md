# 002 — Telegram delivery + manual render CI

**Status:** done
**Completed:** 2026-11-06

## Goal

Trigger a render by hand from GitHub, and have the resulting MP4 show up in a
Telegram chat. Also provide local scripts for the same round trip.

## Shipped

| File | Purpose |
| --- | --- |
| `scripts/telegram-send.mjs` | Send a text message or a file |
| `scripts/telegram-poller.mjs` | Long-poll `getUpdates`, print incoming messages |
| `scripts/telegram-file-sender.mjs` | Upload a file; `document` (default) or `link` mode |
| `scripts/tmpfiles-upload.mjs` | Upload to tmpfiles.org, print the download URL |
| `.github/workflows/telegram-render.yml` | Manual `workflow_dispatch` render → Telegram |

## Notes / gotchas found

- Telegram rejects bot uploads over **50 MB**; the sender falls back to a
  tmpfiles link unless `--strict` is passed.
- tmpfiles returns `{"status":"success"}` (a string), not `true`.
- Bots receive only mentions in groups until privacy mode is disabled **and**
  the bot is re-added — a BotFather privacy change does not apply to existing
  memberships.
- Migrating a group to a supergroup changes its chat id.
- The bundled FFmpeg download has to succeed *before* the render; restoring the
  `vendor/` cache before `pnpm install` skips the ~80 MB download.

## Follow-ups

- See `tickets/004` for a push/PR CI check that would catch FFmpeg breakage
  before release.
