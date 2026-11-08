import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { Browser, getInstalledBrowsers } from "@puppeteer/browsers";

const inputs = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const outputDir = process.argv[3];
const browserPath = process.argv[4] || undefined;
// argv[5] is the engine: "chrome" (default), "obscura", or "auto".
const engine = (process.argv[5] || "chrome").toLowerCase();
// argv[6] is the Obscura CDP endpoint, when one was configured.
const browserUrlArg = process.argv[6] || undefined;

const cacheDir = join(homedir(), ".cache", "puppeteer");

function findSystemBrowser() {
  const candidates = process.platform === "win32"
    ? [
        process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
        process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}/Google/Chrome/Application/chrome.exe`,
        process.env["PROGRAMFILES(X86)"] && `${process.env["PROGRAMFILES(X86)"]}/Google/Chrome/Application/chrome.exe`,
        process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}/Microsoft/Edge/Application/msedge.exe`,
      ]
    : [];
  return candidates.find((candidate) => candidate && existsSync(candidate)) || undefined;
}

async function resolveExecutablePath() {
  // 1. Explicit --browser-path: always used as-is, never downloaded.
  if (browserPath) return browserPath;

  // 2. Shared puppeteer cache (offline): reuse the newest installed Chrome.
  try {
    const installed = await getInstalledBrowsers({ cacheDir });
    const chrome = installed
      .filter((b) => b.browser === Browser.CHROME)
      .sort((a, b) => b.buildId.localeCompare(a.buildId, undefined, { numeric: true }))[0];
    if (chrome && existsSync(chrome.executablePath)) return chrome.executablePath;
  } catch {
    // fall through to system browser detection
  }

  // 3. System Chrome/Edge.
  const systemBrowser = findSystemBrowser();
  if (systemBrowser) return systemBrowser;

  // 4. Lazy one-time download (same installer as `npx kino setup`).
  const setupScript = fileURLToPath(new URL("./install-browser.mjs", import.meta.url));
  const installedPath = execFileSync(process.execPath, [setupScript, "--print-path"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    timeout: 600000,
  })
    .trim()
    .split(/\r?\n/)
    .pop();
  if (!installedPath || !existsSync(installedPath)) {
    throw new Error("Chrome setup finished without a usable executable path.");
  }
  return installedPath;
}

/**
 * Where Obscura is listening.
 *
 * Obscura serves the Chrome DevTools Protocol, so Puppeteer drives it the same
 * way it drives Chrome — the page code below is unchanged. Only the launch step
 * differs: `connect` to an endpoint instead of spawning a binary.
 */
const obscuraUrl =
  browserUrlArg || process.env.OBSCURA_URL || process.env.OBSCURA_CDP_URL || "http://127.0.0.1:9222";

/** True when something is listening at the Obscura endpoint. */
async function obscuraAvailable() {
  try {
    const res = await fetch(`${obscuraUrl.replace(/\/$/, "")}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const useObscura =
  engine === "obscura" || (engine === "auto" && (await obscuraAvailable()));

if (engine === "obscura" && !(await obscuraAvailable())) {
  throw new Error(
    `browser: "obscura" was requested but nothing is listening at ${obscuraUrl}.\n` +
      `  Start it with:  obscura serve --port 9222\n` +
      `  Or point at it with --browser-url / OBSCURA_URL.`
  );
}

let executablePath;
if (!useObscura) {
  try {
    executablePath = await resolveExecutablePath();
  } catch (err) {
    throw new Error(
      `No browser executable available for HTML elements. Run \`npx kino setup\` to download Chrome, or pass --browser-path. (${err.message})`
    );
  }
}

let browser;
try {
  browser = useObscura
    ? await puppeteer.connect({ browserURL: obscuraUrl, defaultViewport: null })
    : await puppeteer.launch({ headless: true, executablePath });
} catch (err) {
  throw new Error(
    useObscura
      ? `Failed to connect to Obscura at ${obscuraUrl}. Is it running? (${err.message})`
      : `Failed to launch browser at ${executablePath}. Run \`npx kino setup\` or pass a valid --browser-path. (${err.message})`
  );
}

try {
  const results = [];
  const batchSize = 4;
  for (let start = 0; start < inputs.length; start += batchSize) {
    const batch = inputs.slice(start, start + batchSize);
    const rendered = await Promise.all(batch.map(async (input, offset) => {
      const page = await browser.newPage();
      const output = `${outputDir}/html-output-${start + offset + 1}.png`;
      try {
        await page.setViewport({ width: input.width, height: input.height, deviceScaleFactor: input.deviceScaleFactor || 1 });
        await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${input.backgroundColor || "transparent"}}${input.css || ""}</style></head><body>${input.html}</body></html>`, { waitUntil: "load" });
        await page.evaluate(() => document.fonts?.ready);
        await page.screenshot({ path: output, omitBackground: !input.backgroundColor });
        return output;
      } finally {
        await page.close();
      }
    }));
    results.push(...rendered);
  }
  process.stdout.write(JSON.stringify(results));
} finally {
  // `connect` only owns a session; closing would kill the user's Obscura.
  if (useObscura) await browser.disconnect();
  else await browser.close();
}
