import type { BrowserEngine, RenderOptions, VideoEncoder } from "./types/render.js";
import { PREVIEW_DEFAULT_HEIGHT } from "./types/render.js";

/**
 * One definition of the CLI's render flags, shared by `kino <file>` and
 * `renderFromArgv()` so a script and the CLI can never drift apart.
 */
export interface ParsedArgs {
  /** Positional file argument, if any. */
  input?: string;
  options: Partial<RenderOptions>;
  dryRun: boolean;
  help: boolean;
}

/**
 * Parses render flags. Unknown flags are ignored rather than rejected so a
 * script can add its own arguments without Kino swallowing them.
 */
export function parseRenderArgs(argv: string[]): ParsedArgs {
  const options: Partial<RenderOptions> = {};
  let input: string | undefined;
  let dryRun = false;
  let help = false;
  let preview: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "render") continue;

    if (arg === "-o" || arg === "--output") {
      options.output = argv[++i] || "./out.mp4";
    } else if (arg === "--ffmpeg-path") {
      options.ffmpegPath = argv[++i];
    } else if (arg === "--browser-path") {
      options.browserPath = argv[++i];
    } else if (arg === "--browser") {
      options.browser = argv[++i] as BrowserEngine;
    } else if (arg === "--browser-url") {
      options.browserUrl = argv[++i];
    } else if (arg === "-e" || arg === "--encoder") {
      options.encoder = argv[++i] as VideoEncoder;
    } else if (arg === "--gpu") {
      options.encoder = "auto";
    } else if (arg === "--preset") {
      options.preset = argv[++i];
    } else if (arg === "--crf") {
      options.crf = Number(argv[++i]);
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--no-asset-cache") {
      options.assetCache = false;
    } else if (arg === "--asset-cache-dir") {
      options.assetCacheDir = argv[++i];
    } else if (arg === "--ytdlp") {
      options.ytdlp = true;
    } else if (arg === "--ytdlp-cookies") {
      options.ytdlpCookies = argv[++i];
    } else if (arg === "--scene") {
      options.scene = argv[++i];
    } else if (arg === "--unsafe-inline-text") {
      options.unsafeInlineText = true;
    } else if (arg === "--verbose") {
      options.verbose = true;
    } else if (arg === "--preview") {
      const next = argv[i + 1];
      if (next && /^\d+$/.test(next)) {
        preview = Number(next);
        i++;
      } else {
        preview = PREVIEW_DEFAULT_HEIGHT;
      }
    } else if (arg.startsWith("--preview=")) {
      const raw = arg.slice("--preview=".length);
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`--preview expects a height in pixels (got '${raw}').`);
      }
      preview = Math.round(parsed);
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (!arg.startsWith("-") && !input) {
      input = arg;
    }
  }

  if (preview !== undefined) options.preview = preview;
  options.output = options.output ?? "./out.mp4";
  return { input, options, dryRun, help };
}

/** The flags accepted by `parseRenderArgs`, for help text. */
export const RENDER_FLAGS: ReadonlyArray<readonly [string, string]> = [
  ["-o, --output <path>", "Output video file path (default: ./out.mp4)"],
  ["-e, --encoder <name>", "Video encoder (libx264, h264_nvenc, hevc_nvenc, h264_qsv, h264_amf, h264_videotoolbox, auto)"],
  ["--preset <name>", "Encoder preset (per-encoder; e.g. NVENC p1-p7, x264 veryfast/slow)"],
  ["--crf <n>", "Encoder quality, 0-51, lower is better (default 20)"],
  ["--gpu", "Enable GPU hardware acceleration (alias for --encoder auto with CPU fallback)"],
  ["--ffmpeg-path <path>", "Use a specific ffmpeg binary instead of the bundled one"],
  ["--browser-path <path>", "Chrome/Chromium executable for HTML elements"],
  ["--scene <id>", "Render only this scene (its timeline is rebased to zero)"],
  ["--preview [height]", "Fast preview: downscale output to <height>px tall (default 144) with ultrafast"],
  ["--dry-run", "Compile to a .kino artifact and print the FFmpeg command without rendering"],
  ["--no-asset-cache", "Re-download remote assets instead of using the on-disk cache"],
  ["--asset-cache-dir <p>", "Directory for the remote asset cache (default: ./.kino-cache)"],
  ["--ytdlp", "Allow yt: sources, fetched with the yt-dlp binary on PATH (not bundled)"],
  ["--ytdlp-cookies <file>", "Netscape cookie jar passed to yt-dlp"],
  ["--unsafe-inline-text", "Disable textfile delivery (apostrophes may render blank)"],
  ["--verbose", "Show full FFmpeg output logs during render"],
  ["-h, --help", "Show help output"],
];
