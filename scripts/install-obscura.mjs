#!/usr/bin/env node
// Installs Obscura into the shared cache (~/.cache/kino/obscura). Idempotent:
// no-op when the current release is already present.
//
// Obscura is a single static binary that speaks the Chrome DevTools Protocol,
// so Kino can use it for HTML elements instead of Chrome. It needs no
// libatk/libnss chain, which is what makes it useful on minimal machines where
// Chrome refuses to start.
//
// Modes:
//   (no args)     user-facing setup; prints progress + result to stdout
//   --print-path  prints ONLY the binary path to stdout, so scripts can capture
//                 it programmatically

import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const CACHE_DIR = join(homedir(), ".cache", "kino", "obscura");
const VERSION_FILE = join(CACHE_DIR, "version");
const printPath = process.argv.includes("--print-path");

const REPO = "h4ckf0r0day/obscura";

function log(message) {
  if (!printPath) console.log(message);
}

/** Release asset suffix for this platform, or a clear error. */
function assetFor(platform, arch) {
  const os = platform === "win32" ? "windows" : platform === "darwin" ? "macos" : "linux";
  const cpu = arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : undefined;
  if (!cpu) throw new Error(`Obscura has no build for ${platform}/${arch}.`);
  const ext = platform === "win32" ? "zip" : "tar.gz";
  return `obscura-${cpu}-${os}.${ext}`;
}

function binaryName() {
  return process.platform === "win32" ? "obscura.exe" : "obscura";
}

async function latestTag() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`Cannot query Obscura releases (HTTP ${res.status}).`);
  const { tag_name } = await res.json();
  if (!tag_name) throw new Error("Obscura releases returned no tag.");
  return tag_name;
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}) for ${url}`);
  mkdirSync(CACHE_DIR, { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

function extract(archive, dir) {
  if (archive.endsWith(".zip")) {
    execFileSync("unzip", ["-o", "-q", archive, "-d", dir], { stdio: "inherit" });
  } else {
    execFileSync("tar", ["xzf", archive, "-C", dir], { stdio: "inherit" });
  }
}

async function main() {
  const bin = join(CACHE_DIR, binaryName());

  // Already installed and matching the latest release: nothing to do.
  let installed = existsSync(bin) ? readFileSync(VERSION_FILE, "utf8").trim() : undefined;
  const tag = await latestTag();

  if (installed === tag) {
    log(`[kino] Obscura ${tag} already installed.`);
    if (printPath) process.stdout.write(bin);
    else log(`[kino] ${bin}`);
    return;
  }

  const asset = assetFor(process.platform, process.arch);
  const url = `https://github.com/${REPO}/releases/download/${tag}/${asset}`;
  log(`[kino] Downloading Obscura ${tag} (${asset})...`);

  mkdirSync(CACHE_DIR, { recursive: true });
  const archive = join(CACHE_DIR, asset);
  await download(url, archive);

  log("[kino] Extracting...");
  extract(archive, CACHE_DIR);
  // The archive holds the binary plus a worker binary; both are needed.
  if (process.platform !== "win32") {
    for (const name of ["obscura", "obscura-worker"]) {
      const p = join(CACHE_DIR, name);
      if (existsSync(p)) chmodSync(p, 0o755);
    }
  }
  writeFileSync(VERSION_FILE, `${tag}\n`, "utf8");

  if (!existsSync(bin)) {
    throw new Error(`Obscura archive did not contain ${binaryName()}.`);
  }

  if (printPath) {
    process.stdout.write(bin);
  } else {
    log(`[kino] Obscura ${tag} installed.`);
    log(`[kino] ${bin}`);
    log("");
    log("  Start it, then render with --browser obscura:");
    log(`    "${bin}" serve --port 9222`);
    log("    npx kino examples/showcase.ts -o out.mp4 --browser obscura");
  }
}

main().catch((err) => {
  console.error(`[kino] Obscura setup failed: ${err.message}`);
  process.exit(1);
});
