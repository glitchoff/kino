import { compile } from "./pipeline/index.js";
import { render } from "./pipeline/render.js";
import { parseRenderArgs, RENDER_FLAGS } from "./cli-args.js";
import type { KinoComposition } from "./types/composition.js";
import type { RenderOptions } from "./types/render.js";

export interface RenderFromArgvOptions {
  /** Arguments to parse. Defaults to `process.argv.slice(2)`. */
  argv?: string[];
  /** Values used when the matching flag is absent. */
  defaults?: Partial<RenderOptions>;
  /** Do nothing (and return `undefined`) when `--help` is passed. Default true. */
  handleHelp?: boolean;
}

/**
 * Renders a composition using the same flags as the CLI, so a script is both
 * runnable directly and usable through `kino`.
 *
 * ```ts
 * const video = composition({ width: 1080 }).scene({ duration: 5 }).build();
 *
 * if (import.meta.main) await renderFromArgv(video);
 * ```
 *
 * Returns the output path, or `undefined` for `--dry-run` / `--help`.
 */
export async function renderFromArgv(
  composition: KinoComposition,
  options: RenderFromArgvOptions = {}
): Promise<{ output: string } | undefined> {
  const argv = options.argv ?? process.argv.slice(2);
  const parsed = parseRenderArgs(argv);

  if (parsed.help) {
    if (options.handleHelp !== false) {
      console.log(RENDER_FLAGS.map(([flag, description]) => `  ${flag.padEnd(24)} ${description}`).join("\n"));
      return undefined;
    }
  }

  const merged: Partial<RenderOptions> = { ...options.defaults, ...parsed.options };
  const output = merged.output ?? "./out.mp4";

  if (parsed.dryRun) {
    const { args, kinoFilePath } = compile(composition, merged);
    console.log(`[kino dry-run] Compiled portable .kino artifact: ${kinoFilePath}`);
    console.log(`[kino dry-run] FFmpeg command:\nffmpeg ${args.join(" ")}`);
    return undefined;
  }

  const result = await render(composition, { ...merged, output } as RenderOptions);
  return result;
}
