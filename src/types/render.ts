/** Engine that rasterises `type: "html"` elements. */
export type BrowserEngine = "chrome" | "obscura" | "auto";

export type VideoEncoder =
  | "libx264"
  | "h264_nvenc"
  | "hevc_nvenc"
  | "h264_qsv"
  | "h264_amf"
  | "h264_videotoolbox"
  | "auto";

export interface RenderOptions {
  output: string;
  ffmpegPath?: string;
  overwrite?: boolean;
  verbose?: boolean;
  encoder?: VideoEncoder;
  preset?: string;
  kinoPath?: string;
  unsafeInlineText?: boolean;
  browserPath?: string;
  /**
   * Pre-rendered PNGs for `tak:` markup, keyed by element.
   *
   * `compile()` is synchronous and Takumi is async, so the caller renders those
   * elements first (`renderTakumiBatch`) and passes the result in. `render()`
   * and `exportComposition()` do this automatically.
   */
  takumiRenders?: Map<unknown, string>;
  /**
   * Which engine renders `type: "html"` elements.
   *
   * - `"chrome"` (default) launches Chrome/Chromium via Puppeteer.
   * - `"obscura"` connects to a running [Obscura](https://docs.obscura.sh/)
   *   CDP endpoint. Obscura is a Rust headless browser that speaks the Chrome
   *   DevTools Protocol, so the same Puppeteer code drives it.
   * - `"auto"` uses Obscura when an endpoint is configured, Chrome otherwise.
   */
  browser?: BrowserEngine;
  /**
   * CDP endpoint for Obscura, e.g. `http://127.0.0.1:9222`. Defaults to
   * `OBSCURA_URL`, then to Obscura's usual port.
   */
  browserUrl?: string;
  /**
   * Fast preview mode. When set, the final video is downscaled to this height
   * (width follows the source aspect ratio) and encoded with `ultrafast`/CRF 30.
   * `true` means 144p. The scene graph is unchanged — only the output stage
   * differs, so a preview that looks right will render right.
   */
  preview?: boolean | number;
  /**
   * Cache remote assets on disk, keyed by URL hash, so re-renders skip the
   * download. Defaults to `true`; pass `false` to always re-fetch.
   */
  assetCache?: boolean;
  /** Override the asset cache directory (default `.kino-cache/` in the cwd). */
  assetCacheDir?: string;
  /**
   * Allow `yt:` sources, fetched with the `yt-dlp` binary on PATH. Off by
   * default; Kino never installs yt-dlp.
   */
  ytdlp?: boolean;
  /** Render only this scene by id; its timeline is rebased to zero. */
  scene?: string;
  /** Netscape cookie jar forwarded to yt-dlp as `--cookies`. */
  ytdlpCookies?: string;
}

/** Preview output height in pixels; `true` maps to 144p. */
export const PREVIEW_DEFAULT_HEIGHT = 144;

export function resolvePreviewHeight(preview: boolean | number | undefined): number | undefined {
  if (!preview) return undefined;
  if (preview === true) return PREVIEW_DEFAULT_HEIGHT;
  return Math.max(16, Math.round(preview));
}

export interface CompileResult {
  args: string[];
  filtergraph?: string;
  kinoFilePath: string;
}
