#!/usr/bin/env node
// Installs Chrome (via @puppeteer/browsers) into the shared puppeteer cache
// (~/.cache/puppeteer). Idempotent: no-op when the current stable build is
// already present. Called by `npx kino setup` and lazily by HTML rendering.
//
// Modes:
//   (no args)     user-facing setup; prints progress + result to stdout
//   --print-path  prints ONLY the resolved Chrome executable path to stdout
//                 (no other output) so scripts can capture it programmatically

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  Browser,
  computeExecutablePath,
  detectBrowserPlatform,
  install,
  resolveBuildId,
} from "@puppeteer/browsers";

const CACHE_DIR = join(homedir(), ".cache", "puppeteer");
const printPath = process.argv.includes("--print-path");

function log(message) {
  if (!printPath) console.log(message);
}

async function main() {
  const platform = detectBrowserPlatform();
  if (!platform) {
    throw new Error("Unsupported platform for Chrome download.");
  }

  log("[kino] Locating Chrome for HTML rendering...");
  const buildId = await resolveBuildId(Browser.CHROME, platform, "stable");

  let executablePath;
  try {
    executablePath = computeExecutablePath({
      browser: Browser.CHROME,
      buildId,
      cacheDir: CACHE_DIR,
    });
    if (!existsSync(executablePath)) executablePath = undefined;
  } catch {
    executablePath = undefined;
  }

  if (!executablePath) {
    log("[kino] Chrome not found in browser cache. Downloading (one-time)...");
    const installed = await install({
      browser: Browser.CHROME,
      buildId,
      cacheDir: CACHE_DIR,
      downloadProgressCallback: "default",
    });
    executablePath = installed.executablePath;
    log(`[kino] Chrome installed to ${executablePath}`);
  } else {
    log(`[kino] Chrome already installed at ${executablePath}`);
  }

  if (printPath) {
    process.stdout.write(executablePath);
  }
}

main().catch((error) => {
  console.error(`[kino] Browser setup failed: ${error.message}`);
  process.exit(1);
});
