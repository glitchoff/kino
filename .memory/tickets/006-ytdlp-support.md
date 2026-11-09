# 006 — Optional yt-dlp support

**Status:** shipped (`759f719`) — personal use only
**Created:** 2026-11-06

> **Scope note:** this is a private capability for the repo owner, not a public
> feature. No user-facing docs, no README entry, no changelog mention. The
> implementation should stay small and out of the way.

## Goal

Let a composition reference a video URL that FFmpeg cannot fetch directly
(YouTube and friends) and have Kino pull it through `yt-dlp` — **optional,
external, never bundled**.

**The user must have `yt-dlp` installed and on `PATH`.** Kino does not install
it, download it, or manage its version. If it is missing, Kino fails with an
actionable error and stops — there is no fallback, no auto-install, no
`kino setup yt-dlp` command.

## Design

```ts
s.video("yt:https://www.youtube.com/watch?v=abc123", { trimStart: 30, duration: 10 })
```

- The `yt:` prefix is the opt-in marker. A bare `https://…` URL keeps today's
  behaviour (direct fetch), so nothing existing changes.
- `yt-dlp` is resolved from `PATH` only. No bundled binary, no managed download.
- Downloads land in the existing asset cache (`src/remote/downloader.ts`),
  keyed on video id + format selector + section range + yt-dlp version.

## Decisions from research (yt-dlp 2026.10.26)

| Topic | Decision | Why |
| --- | --- | --- |
| Trimming | **Download full source, trim in Kino** | `--download-sections` uses `-c copy`, so cuts snap to keyframes. Its own FAQ says cuts "cannot be exact without re-encoding". Kino's `trimStart` is already frame-accurate. |
| JS runtime | Always pass `--js-runtimes node` | Modern yt-dlp needs a JS runtime to solve YouTube challenges; Node ≥22 is not auto-detected. We run inside Node, so it is free. |
| Output path | `--print after_move:filepath`, take last stdout line | Officially recommended for embedding; the real filename is unknown until after merge. |
| Container | `-t mp4` preset | `--merge-output-format mp4` stream-copies and fails on VP9+Opus; `-t mp4` steers selection toward h264/aac and remuxes. |
| `player_client` | **Never pin** | Defaults change constantly (`tv_samsung,visionos,web` today). Expose `--extractor-args` as pass-through only. |
| Playlists | `--no-playlist` always | `watch?v=X&list=Y` otherwise downloads the whole playlist. |
| User config | `--ignore-config` always | A user's `~/.config/yt-dlp/config` could inject `-o -` or `--exec`. |
| Errors | Parse stderr, not exit codes | Exit codes are only `0`/`1`/`2`; `1` covers private, geo-blocked, and network death alike. |

### Invocation

```bash
yt-dlp --ignore-config --no-playlist --no-warnings --no-progress --color never \
  --js-runtimes node -f "bv*[height<=720]+ba/b[height<=720]" -t mp4 \
  -o "%(id)s.%(ext)s" -P "<staging-dir>" \
  --print after_move:filepath "<url>"
```

### Error matchers

Match the last `ERROR:` line (all diagnostics go to stderr; `--print` owns stdout).

| Condition | Regex (case-insensitive) | Kino message |
| --- | --- | --- |
| Bot check | `Sign in to confirm you` (note the curly `’`) | "YouTube is asking for sign-in — pass `--cookies`" |
| Rate limited | `rate-limited by YouTube` / `HTTP Error 429` | "Rate limited; wait or use cookies" |
| Private | `Private video` | "This video is private" |
| Removed | `Video unavailable` / `This video is not available` | "This video is unavailable" |
| Geo-blocked | `not made this video available in your country` | "Geo-blocked" |
| Age-gated | `Sign in to confirm your age` | "Age-restricted; needs cookies" |
| Unsupported | `Unsupported URL` | "yt-dlp does not support this URL" |
| Bad flags | exit `2` | Internal — surface raw stderr |

Match **prefixes**, not full strings: wording drifts between releases.

## Constraints to document

- **CI cannot use this.** YouTube blocks datacenter IPs ("Sign in to confirm
  you're not a bot" was reproduced in this Codespace on default, `android`, and
  `web_safari` clients). The Telegram render workflow must never depend on it.
- **No server-side cache.** Every run re-extracts and re-downloads, so Kino's
  own cache is what makes repeat renders tolerable.
- **Rate limits are documented:** ~300 videos/hour for guest sessions
  (~2000 with an account). Cache aggressively; do not loop.
- **Licensing:** yt-dlp *source* is Unlicense, but the standalone PyInstaller
  binaries are **GPLv3+**. Kino never ships either — the user installs yt-dlp
  themselves, so there is no redistribution at all.
- **Cookies are the only reliable cloud path.** `--cookies <file>` with a
  Netscape-format jar. Never default to `--cookies-from-browser`: it exports
  every cookie for every site.
- **Account risk is real.** yt-dlp's wiki: "By using your account with yt-dlp,
  you run the risk of it being banned."

## Related work this unlocks

`trimStart` exists but there is no `trimEnd`, and `parseDuration` does not accept
`mm:ss`. Both are needed to express "32s to 45s of a video" naturally:

```ts
s.video("yt:https://…", { trimStart: "0:32", trimEnd: "0:45" })
```

Ship these with the yt-dlp work — they are the same feature from a user's view.

> **Status 2026-11-07:** in progress, uncommitted. `trimEnd` (type, builder,
> normalizer, validator) and `mm:ss` / `hh:mm:ss` parsing are edited and
> typecheck, but there are no tests or docs yet. Finish before relying on it.

## Open questions

- Default height cap: `720p` seems right for a renderer, but it should be
  overridable per element (`{ source: { maxHeight: 1080 } }`?).
- Minimum supported `yt-dlp` version — do we check, or just let it fail with
  yt-dlp's own error?
