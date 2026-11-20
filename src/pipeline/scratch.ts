import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface ScratchOptions {
  /** The render's output path; scratch sits beside it. */
  outputPath?: string;
  /**
   * Prefer a RAM disk for scratch. Opt-in — a render that quietly fills memory
   * is worse than a slow one, so this is never the default.
   *
   * Linux: `/dev/shm` is a real RAM disk and is used automatically.
   * Windows: no built-in equivalent, so `KINO_RAMDISK` must name one (e.g.
   * `R:\`). Without it, this falls back to disk and warns rather than silently
   * pretending to be in memory.
   */
  ram?: boolean;
}

/**
 * Where kino puts scratch files: staging dirs, extracted artifacts, caption
 * PNGs, Takumi output, preview frames.
 *
 * **Scratch lives next to the output, in a hidden `.kino/` folder.** A render
 * writing `out/clip.mp4` stages in `out/.kino/`.
 *
 * Why there, rather than `os.tmpdir()`:
 *
 * - It is on the same filesystem as the output, so nothing crosses a disk
 *   boundary on the final move, and it is as fast as the output write itself.
 * - The system temp dir is often on the *smallest* partition. On the machine
 *   this was written for, `C:` had 3.1 GB free while the project disk had 61 GB;
 *   a long captioned render writes one PNG per word, and filling a 3 GB drive is
 *   how a render dies halfway with ENOSPC.
 * - It is predictable and obvious: you can see the work, and delete it, without
 *   hunting through `%LOCALAPPDATA%`.
 *
 * `KINO_TMP` overrides everything. With `ram: true`, a RAM disk is preferred
 * when one exists — see {@link ScratchOptions.ram}.
 *
 * Each render removes its own subdirectory; the `.kino/` folder itself is left
 * in place so a concurrent render sharing the directory is not disturbed.
 */
export function scratchRoot(options: ScratchOptions = {}): string {
  const override = process.env.KINO_TMP;
  if (override && override.trim()) {
    const dir = resolve(override.trim());
    if (ensureDir(dir)) return dir;
    // An unwritable override is worse than the default, so fall through rather
    // than fail a render over a path problem.
  }

  if (options.ram) {
    const ram = ramDiskRoot();
    if (ram) return ram;
    // Never pretend: if the caller asked for memory and did not get it, say so.
    console.warn(
      "[kino] scratch: no RAM disk available, using disk. " +
        "On Linux use /dev/shm; on Windows set KINO_RAMDISK to a RAM-disk drive."
    );
  }

  const base = options.outputPath ? dirname(resolve(options.outputPath)) : process.cwd();
  const dir = join(base, ".kino");
  if (ensureDir(dir)) return dir;

  // The output directory may be read-only or not exist yet. Falling back to the
  // process cwd keeps the render working and still stays off the system temp
  // drive.
  const fallback = join(process.cwd(), ".kino");
  if (ensureDir(fallback)) return fallback;

  // Last resort only: nothing writable was found near the output or the cwd.
  return mkdtempSync(join(base, "kino-scratch-"));
}

/**
 * A writable RAM-disk directory, or undefined.
 *
 * Linux exposes `/dev/shm` as `tmpfs` with no setup. Windows has no equivalent,
 * so the caller has to name one through `KINO_RAMDISK` — kino will not guess at
 * a drive letter, because a typo would silently land on a real disk.
 */
function ramDiskRoot(): string | undefined {
  if (process.platform === "linux") {
    const shm = "/dev/shm/kino";
    return ensureDir(shm) ? shm : undefined;
  }
  if (process.platform === "win32") {
    const named = process.env.KINO_RAMDISK;
    if (!named || !named.trim()) return undefined;
    const dir = join(resolve(named.trim()), "kino");
    return ensureDir(dir) ? dir : undefined;
  }
  return undefined;
}

/** Creates `dir` if needed; false when it cannot be created. */
function ensureDir(dir: string): boolean {
  if (existsSync(dir)) return true;
  try {
    mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/** A fresh subdirectory under {@link scratchRoot}. */
export function scratchDir(prefix: string, options: ScratchOptions = {}): string {
  return mkdtempSync(join(scratchRoot(options), prefix));
}
