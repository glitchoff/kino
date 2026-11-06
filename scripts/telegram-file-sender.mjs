// Send a file to Telegram: upload to tmpfiles first, then send link (or send as document).
// Usage: node scripts/telegram-file-sender.mjs <file> [--caption "..."] [--mode link|document]
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function loadEnv() {
  try {
    for (const line of readFileSync(join(homedir(), ".config/meowscrada/env"), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {}
}
loadEnv();

const file = process.argv[2];
if (!file || !existsSync(file)) { console.error("Usage: node scripts/telegram-file-sender.mjs <file> [--caption \"...\"] [--mode link|document]"); process.exit(1); }
const caption = process.argv.includes("--caption") ? process.argv[process.argv.indexOf("--caption") + 1] : "";
const mode = process.argv.includes("--mode") ? process.argv[process.argv.indexOf("--mode") + 1] : "link";

if (mode === "document") {
  spawnSync("node", ["scripts/telegram-send.mjs", "--file", file, ...(caption ? ["--caption", caption] : [])], { stdio: "inherit" });
} else {
  const up = spawnSync("node", ["scripts/tmpfiles-upload.mjs", file, "--quiet"], { encoding: "utf8" });
  if (up.status !== 0) { console.error(up.stderr || "upload failed"); process.exit(1); }
  const dl = up.stdout.trim();
  spawnSync("node", ["scripts/telegram-send.mjs", `${caption ? caption + "\n\n" : ""}${dl}`], { stdio: "inherit" });
  console.log(dl);
}
