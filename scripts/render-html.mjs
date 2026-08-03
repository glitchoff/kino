import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer";

const input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const output = process.argv[3];
const browserPath = process.argv[4] || undefined;

let browser;
try {
  browser = await puppeteer.launch({ headless: true, executablePath: browserPath });
} catch (firstError) {
  if (browserPath) throw firstError;
  const systemBrowsers = process.platform === "win32"
    ? [
        process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
        process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}/Google/Chrome/Application/chrome.exe`,
        process.env["PROGRAMFILES(X86)"] && `${process.env["PROGRAMFILES(X86)"]}/Google/Chrome/Application/chrome.exe`,
        process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}/Microsoft/Edge/Application/msedge.exe`,
      ]
    : [];
  const systemBrowser = systemBrowsers.find((candidate) => candidate && existsSync(candidate));
  if (systemBrowser) {
    browser = await puppeteer.launch({ headless: true, executablePath: systemBrowser });
  }
  if (browser) {
    // Continue with the detected system browser.
  } else {
  const puppeteerCli = fileURLToPath(new URL("../node_modules/puppeteer/lib/esm/puppeteer/node/cli.js", import.meta.url));
  const installedPath = execFileSync(process.execPath, [puppeteerCli, "browsers", "install", "chrome@latest", "--format", "{{path}}"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], timeout: 300000 }).trim().split(/\r?\n/).pop();
  if (!installedPath) throw firstError;
  browser = await puppeteer.launch({ headless: true, executablePath: installedPath });
  }
}
try {
  const page = await browser.newPage();
  await page.setViewport({ width: input.width, height: input.height, deviceScaleFactor: input.deviceScaleFactor || 1 });
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${input.backgroundColor || "transparent"}}${input.css || ""}</style></head><body>${input.html}</body></html>`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts?.ready);
  await page.screenshot({ path: output, omitBackground: !input.backgroundColor });
} finally {
  await browser.close();
}
