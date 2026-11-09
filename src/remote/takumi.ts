/**
 * Browserless HTML via [Takumi](https://takumi.kane.tw/).
 *
 * Markup is marked with a `tak:` prefix, mirroring the `yt:` convention used for
 * yt-dlp: the marker travels with the input, so `html("tak:…")` renders without
 * a browser wherever it appears, including through `.add()` outside a scene.
 */
export const TAKUMI_PREFIX = "tak:";

export function isTakumiMarkup(markup: string): boolean {
  return markup.startsWith(TAKUMI_PREFIX);
}

/** Strips the `tak:` marker, leaving the markup Takumi should lay out. */
export function takumiMarkup(markup: string): string {
  return markup.slice(TAKUMI_PREFIX.length);
}

export const TAKUMI_MISSING_HINT =
  "`tak:` markup needs the takumi-js package, which is not installed. " +
  "Run `pnpm add takumi-js`, or drop the `tak:` prefix to render with a browser.";
