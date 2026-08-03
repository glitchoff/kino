import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const cli = resolve("node_modules/puppeteer/lib/esm/puppeteer/node/cli.js");
if (!existsSync(cli)) process.exit(0);

try {
  execFileSync(process.execPath, [cli, "browsers", "install", "chrome@stable"], {
    stdio: "inherit",
    timeout: 300000,
  });
} catch (error) {
  console.warn("[kino] Chromium download failed. Install Chrome manually or use --browser-path.");
  console.warn("[kino] HTML elements will require a browser executable at render time.");
}
