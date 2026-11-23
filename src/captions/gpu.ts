/**
 * Locating the `gpucap` text renderer.
 *
 * `gpucap` is a small Rust binary that lays out caption text with cosmic-text
 * and draws it through a GPU glyph atlas. It exists because ffmpeg's `drawtext`
 * costs roughly four filters per karaoke word — `split`, `crop`, a second
 * `drawtext` in the highlight colour, and an `overlay` — so a chapter-length
 * caption track emits thousands of filters in one serial chain and the render
 * stalls on text rather than on the encoder.
 *
 * Resolution order, first hit wins:
 *
 * 1. `gpuTextPath` from the render options — an explicit choice always wins.
 * 2. The binary shipped beside the package: `bin/<platform>-<arch>/gpucap[.exe]`,
 *    downloaded by `scripts/install-gpucap.mjs`.
 * 3. `gpucap` on `PATH` — the path for a local `cargo build`.
 *
 * Missing is not an error. Callers fall back to `drawtext`, which is why the
 * feature is opt-in: a machine without the binary renders exactly what it did
 * before.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, "..", "..");

/** `win32-x64`, `darwin-arm64`, `linux-x64`, … — the release asset folder name. */
export function gpuCapPlatform(): string {
  const os = process.platform === "win32" ? "win32" : process.platform;
  return `${os}-${process.arch}`;
}

/** Where a downloaded binary lives inside the package. */
export function bundledGpuCapPath(): string {
  const exe = process.platform === "win32" ? "gpucap.exe" : "gpucap";
  return join(PACKAGE_ROOT, "bin", gpuCapPlatform(), exe);
}

/**
 * Resolve the `gpucap` binary, or `undefined` when none is available.
 *
 * `explicit` is the caller's `gpuTextPath`. A path that was named explicitly
 * but does not exist is **not** silently skipped — that is a configuration
 * mistake, and falling back would hide it.
 */
export function resolveGpuCap(explicit?: string): string | undefined {
  if (explicit) {
    const abs = resolve(explicit);
    if (!existsSync(abs)) {
      throw new Error(
        `gpuTextPath points at '${explicit}', which does not exist. ` +
          `Build it with \`cargo build --release\` in rust/gpucap, or unset gpuTextPath to fall back to drawtext.`
      );
    }
    return abs;
  }

  const bundled = bundledGpuCapPath();
  if (existsSync(bundled)) return bundled;

  // PATH lookup without a dependency: `where` on Windows, `command -v` elsewhere.
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const out = execFileSync(cmd, ["gpucap"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const first = out.split(/\r?\n/).find((line) => line.trim());
    return first ? first.trim() : undefined;
  } catch {
    return undefined;
  }
}
