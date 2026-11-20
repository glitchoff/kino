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
  /**
   * Resample scaled elements on the GPU with `scale_cuda`. **Default off.**
   *
   * Measured slower end to end (44.5 s vs 39.1 s on a 36 s 1080p bench) even
   * though `scale_cuda` beats swscale 3× in isolation. `zoompan` and `drawtext`
   * have no CUDA variants, so each element pays an upload and a download per
   * frame, and that round trip outweighs the resize.
   *
   * Worth trying only for a graph with no CPU-only filters in the chain. `true`
   * enables it when the binary has a working device; `false` or unset keeps the
   * CPU path. `KINO_SCALE_CUDA=0` disables the probe entirely.
   */
  scaleCuda?: boolean;
  /**
   * Encoder quality, 0–51 for libx264 where lower is better. Default 20, which
   * keeps text crisp; the previous default had no quality target at all and
   * crushed text-heavy frames. Hardware encoders map this to their own quality
   * control.
   */
  crf?: number;
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
   * Fast preview mode. `true` means 144p; a number sets the height (width
   * follows the source aspect ratio).
   *
   * The composition **composites at the preview size** — backgrounds, images,
   * text and blends are all built for the smaller frame — so the per-frame cost
   * scales with the resolution. The scene graph is otherwise unchanged: same
   * elements, same order, same timing, same grade, so a preview shows what the
   * full render will at a lower pixel grid. Fine detail (a 1.5px stroke, a
   * sub-pixel text offset) can round differently.
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
   * Keep render scratch (staging files, caption PNGs, extracted artifacts) in
   * memory instead of on disk. **Opt-in, default off.**
   *
   * On Linux this uses `/dev/shm`. On Windows there is no built-in RAM disk, so
   * `KINO_RAMDISK` must name one (e.g. `R:\`) or this falls back to disk with a
   * warning — it never silently pretends to be in memory.
   *
   * Worth it when the working set fits comfortably in RAM. A render that
   * quietly exhausts memory is worse than a slow one, which is why this is not
   * the default.
   */
  ram?: boolean;
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
