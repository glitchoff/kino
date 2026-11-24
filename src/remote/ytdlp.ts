import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Optional yt-dlp passthrough. `yt-dlp` must be installed and on PATH —
 * Kino never installs or downloads it.
 *
 * Sources are marked with a `yt:` prefix: `yt:https://youtube.com/watch?v=…`.
 */
export const YTDLP_PREFIX = "yt:";

export function isYtdlpSource(src: string): boolean {
  return src.startsWith(YTDLP_PREFIX);
}

/** Strips the `yt:` marker, leaving the real URL. */
export function ytdlpUrl(src: string): string {
  return src.slice(YTDLP_PREFIX.length);
}

const MISSING_HINT =
  "yt-dlp is required for `yt:` sources but was not found on PATH. " +
  "Install it from https://github.com/yt-dlp/yt-dlp#installation";

function cacheKey(url: string, maxHeight: number): string {
  return createHash("sha256").update(`ytdlp:${maxHeight}:${url}`).digest("hex").slice(0, 32);
}

export interface YtdlpFetchOptions {
  /** Directory for the downloaded file. */
  stagingDir: string;
  /** Cache directory; omit to skip caching. */
  cacheDir?: string;
  /** Height cap passed to the format selector. Defaults to 720. */
  maxHeight?: number;
  /** Cookie jar file, forwarded as `--cookies`. */
  cookies?: string;
}

/**
 * The binary to run.
 *
 * `KINO_YTDLP` overrides it — useful for a non-standard install, and required by
 * the tests: Windows resolves `yt-dlp` through PATHEXT, so a `.exe` on PATH wins
 * over a `.cmd` stub no matter what order PATH is in. Pointing this at the stub
 * makes the test independent of what the machine happens to have installed.
 */
function ytdlpBinary(): string {
  return process.env.KINO_YTDLP?.trim() || "yt-dlp";
}

/**
 * Downloads `url` via yt-dlp into `stagingDir` and returns the file name.
 *
 * Trimming is NOT done here: `--download-sections` stream-copies, so cuts land
 * on keyframes. Kino trims afterwards with `trimStart`/`duration`, which is
 * frame-accurate.
 */
/**
 * Quote one argument for `cmd.exe`.
 *
 * `spawnSync` with `shell: true` joins argv with spaces and hands the result to
 * cmd, so an argument is only safe if it contains nothing cmd interprets. The
 * format selector `bv*[height<=720]+ba/b[height<=720]/bv*+ba/b` does: `<` and
 * `>` are redirection operators, `&` and `|` are separators.
 *
 * Double quotes suppress all of them. An argument with no metacharacter is left
 * alone so ordinary paths stay readable in a logged command line.
 */
function quoteForShell(arg: string): string {
  if (arg === "") return '""';
  if (!/[\s<>&|^()"'%]/.test(arg)) return arg;
  // cmd has no escape for `"` inside a quoted string; doubling it is the
  // documented convention for these paths.
  return `"${arg.replace(/"/g, '""')}"`;
}

export function fetchWithYtdlp(url: string, options: YtdlpFetchOptions): string {
  const maxHeight = options.maxHeight ?? 720;
  const key = cacheKey(url, maxHeight);

  let cacheDir: string | undefined;
  if (options.cacheDir) {
    cacheDir = options.cacheDir;
    mkdirSync(cacheDir, { recursive: true });
    const cached = join(cacheDir, `yt-${key}.mp4`);
    if (existsSync(cached)) {
      const name = `yt-${key}.mp4`;
      copyFileSync(cached, join(options.stagingDir, name));
      return name;
    }
  }

  const workDir = cacheDir ?? options.stagingDir;
  const outTemplate = join(workDir, `yt-${key}.%(ext)s`);

  const args = [
    "--ignore-config",
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    "--color",
    "never",
    "--js-runtimes",
    "node",
    "-f",
    // `bv*+ba` fails when a source has no separate audio stream (a direct MP4,
    // for instance), so fall back to the best pre-merged format, then anything.
    `bv*[height<=${maxHeight}]+ba/b[height<=${maxHeight}]/bv*+ba/b`,
    "-S",
    `res:${maxHeight}`,
    "-t",
    "mp4",
    "-o",
    outTemplate,
    "--print",
    "after_move:filepath",
  ];
  if (options.cookies) args.push("--cookies", options.cookies);
  args.push(url);

  // Windows resolves a bare name through PATHEXT. A real install is `yt-dlp.exe`
  // and needs no shell, but a `.cmd` shim (pip's user-site wrapper, or the test
  // stub) can only be launched through one. `shell: true` on Windows is the
  // price of accepting both.
  //
  // **The cost is quoting.** With a shell, Node concatenates argv without
  // escaping it, so cmd reinterprets characters in the arguments themselves.
  // The format selector contains `<` and `>`, which cmd reads as redirection:
  // `bv*[height<=720]` makes it look for a file named `height=` and the spawn
  // dies with "The system cannot find the file specified". Quoting every
  // argument that holds a shell metacharacter is what keeps the selector intact.
  const useShell = process.platform === "win32";
  const argv = useShell ? args.map(quoteForShell) : args;

  const res = spawnSync(ytdlpBinary(), argv, {
    encoding: "utf-8",
    timeout: 600_000,
    maxBuffer: 32 * 1024 * 1024,
    shell: useShell,
  });

  if (res.error) {
    const code = (res.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error(MISSING_HINT);
    throw new Error(`yt-dlp failed: ${res.error.message}`);
  }

  if (res.status !== 0) {
    throw new Error(`yt-dlp failed for ${url}: ${ytdlpReason(res.stderr || "")}`);
  }

  const printed = (res.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .pop();

  if (!printed || !existsSync(printed)) {
    throw new Error(`yt-dlp reported success but produced no file for ${url}`);
  }

  const name = `yt-${key}.mp4`;
  if (printed !== join(options.stagingDir, name)) {
    copyFileSync(printed, join(options.stagingDir, name));
  }
  return name;
}

/** Turns yt-dlp's stderr into one actionable sentence. */
export function ytdlpReason(stderr: string): string {
  const last =
    stderr
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("ERROR:"))
      .pop() ?? stderr.trim().split("\n").pop() ?? "unknown error";

  const rules: Array<[RegExp, string]> = [
    [/Sign in to confirm you/i, "YouTube is asking for sign-in — pass a cookies file with `cookies`"],
    [/requiring a captcha/i, "YouTube is requiring a captcha — try a cookies file"],
    [/rate-limited by YouTube|HTTP Error 429/i, "rate limited by YouTube — wait, or use a cookies file"],
    [/Private video/i, "this video is private"],
    [/Video unavailable|This video is not available/i, "this video is unavailable"],
    [/not made this video available in your country/i, "this video is geo-blocked"],
    [/Sign in to confirm your age/i, "this video is age-restricted — a cookies file is required"],
    [/Unsupported URL/i, "yt-dlp does not support this URL"],
    [/Requested format is not available/i, "no format matched the requested height cap"],
  ];
  for (const [pattern, message] of rules) {
    if (pattern.test(last)) return message;
  }
  return last.replace(/^ERROR:\s*/, "");
}
