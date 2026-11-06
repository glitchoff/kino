# Sources

External references this project depends on. Verify these when something breaks.

## Upstream

| Source | Used for |
| --- | --- |
| [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) | Static Linux FFmpeg with `drawtext` (libfreetype + libharfbuzz). We track the rolling `n8.1` assets under the `latest` tag. |
| [FFmpeg documentation](https://ffmpeg.org/ffmpeg-filters.html) | Filter behaviour, especially `drawtext` |
| [ffmpeg-static](https://www.npmjs.com/package/ffmpeg-static) | Fallback binary on Windows/macOS |

## Packages we build on

| Package | Role |
| --- | --- |
| `puppeteer-core` + `@puppeteer/browsers` | Rendering `html` elements to PNG; lazy Chrome download |
| `adm-zip` | `.kino` artifact container |
| `xz-decompress` + `tar` | Extracting the bundled FFmpeg without system `tar`/`xz` |
| `hono` + `@hono/node-server` | Studio server |
| `zustand`, `react`, `vite` | Studio UI |
| `tsup` | Library + CLI build |
| `vitest` | Tests |

## CI / delivery

| Source | Used for |
| --- | --- |
| [GitHub Actions](https://docs.github.com/actions) | `publish.yml`, `telegram-render.yml` |
| [Telegram Bot API](https://core.telegram.org/bots/api) | `sendMessage`, `sendDocument`, `sendPoll`, `getUpdates` |
| [tmpfiles.org API](https://tmpfiles.org/api) | Optional link delivery for files over Telegram's 50 MB bot limit |

## Notes worth remembering

- Telegram bots cannot upload files larger than **50 MB**; `telegram-file-sender.mjs`
  falls back to a tmpfiles link above that.
- Bots only receive ordinary group messages after privacy mode is disabled
  **and** the bot is removed and re-added to the group. Mentions are always delivered.
- Supergroup migration changes the chat id; re-read it from `getUpdates`.
