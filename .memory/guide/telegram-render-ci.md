# Telegram render CI

`.github/workflows/telegram-render.yml` — manual only (`workflow_dispatch`).

## Trigger

GitHub UI → Actions → **Telegram Render** → Run workflow, or:

```bash
gh workflow run telegram-render.yml \
  -f example=examples/basic.ts \
  -f caption="what changed" \
  -f delivery=document
```

| Input | Values | Default |
| --- | --- | --- |
| `example` | static list of `examples/*.ts` | `examples/basic.ts` |
| `caption` | free text | empty |
| `delivery` | `document` (direct upload), `link` (tmpfiles) | `document` |

## Required secrets

| Secret | Value |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | from BotFather |
| `TELEGRAM_CHAT_ID` | target chat/supergroup id, e.g. `-100…` |

```bash
gh secret set TELEGRAM_BOT_TOKEN -R <owner>/<repo> --body "$TELEGRAM_BOT_TOKEN"
gh secret set TELEGRAM_CHAT_ID   -R <owner>/<repo> --body "$TELEGRAM_CHAT_ID"
```

## How the job is fast

- `vendor/` (the bundled FFmpeg) is cached **before** `pnpm install`, so
  `postinstall` finds the binary and skips the ~80 MB download.
- `node_modules` is cached, keyed on `pnpm-lock.yaml`.
- The build is `pnpm exec tsup` (library + CLI only) — the studio Vite build is
  skipped because rendering does not need it.
- Result: ~30 s for `examples/basic.ts`.

## Render step

```bash
mkdir -p out
node dist/cli.js "$EXAMPLE" -o out/render.mp4 --ffmpeg-path "$FFMPEG_PATH"
```

`FFMPEG_PATH` comes from the drawtext verification step, so the render always
uses the verified binary rather than whatever `ffmpeg-static` resolves to.

## Sending

`scripts/telegram-file-sender.mjs out/render.mp4 --caption … --mode …`

- `document` — uploads the MP4 to Telegram directly.
- `link` — uploads to tmpfiles.org and sends the URL.
- Files over Telegram's 50 MB bot limit automatically fall back to `link`.

## Failure modes seen

| Symptom | Cause |
| --- | --- |
| `HTTP 404` during install | FFmpeg asset URL pinned to a pruned release — see `tickets/003` |
| `has no drawtext support` | render used `ffmpeg-static`; pass `--ffmpeg-path` |
| `Error opening output …/out/render.mp4` | `out/` did not exist; `mkdir -p out` first |
| `Upload failed: OK` | tmpfiles returns `"status":"success"`, not `true` |

## Rendering a long video on CI

`examples/lyrics.ts` is a full-length song with karaoke-style lyrics. It is
self-contained on purpose: the audio (`assets/co2.mp3`) and the word timings
(`assets/co2-words.json`) are committed, so the job needs no model, no network
and no ~317 MB download.

This is the way to render long pieces. A machine with 8 GB and no swap stalls
on the per-word caption graph long before it finishes; a CI runner is both
faster and disposable.

To use your own song, produce the timings locally first (see
`guide/alignment-model.md`), then commit the audio and JSON next to a copy of
`examples/lyrics.ts` and add it to the workflow's `example` list.
