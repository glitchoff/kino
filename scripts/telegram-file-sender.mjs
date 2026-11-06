// Send a file to Telegram.
//
// Modes:
//   --mode document   upload the file to Telegram directly (default, no third party)
//   --mode link       upload to tmpfiles.org first and send the download link
//
// Telegram caps bot uploads at 50 MB; files over that automatically fall back to
// link mode (or fail if --mode document was explicitly requested with --strict).
//
// Usage: node scripts/telegram-file-sender.mjs <file> [--caption "..."] [--mode document|link] [--strict]
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
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

const TELEGRAM_MAX_UPLOAD = 50 * 1024 * 1024;

const args = process.argv.slice(2);
const getArg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const file = args[0];
const caption = getArg("--caption") ?? "";
let mode = getArg("--mode") ?? "document";
const strict = args.includes("--strict");

if (!file || !existsSync(file)) {
  console.error('Usage: node scripts/telegram-file-sender.mjs <file> [--caption "..."] [--mode document|link] [--strict]');
  process.exit(1);
}
if (mode !== "document" && mode !== "link") {
  console.error(`Unknown --mode '${mode}' (expected document or link)`);
  process.exit(1);
}

function sendDocument() {
  const res = spawnSync("node", ["scripts/telegram-send.mjs", "--file", file, ...(caption ? ["--caption", caption] : [])], {
    stdio: "inherit",
  });
  return res.status === 0;
}

function sendLink() {
  const up = spawnSync("node", ["scripts/tmpfiles-upload.mjs", file, "--quiet"], { encoding: "utf8" });
  if (up.status !== 0) {
    console.error(up.stderr?.trim() || "tmpfiles upload failed");
    return false;
  }
  const dl = up.stdout.trim();
  const res = spawnSync("node", ["scripts/telegram-send.mjs", `${caption ? caption + "\n\n" : ""}${dl}`], { stdio: "inherit" });
  if (res.status === 0) console.log(dl);
  return res.status === 0;
}

const size = statSync(file).size;
if (mode === "document" && size > TELEGRAM_MAX_UPLOAD) {
  const mb = (size / 1048576).toFixed(1);
  if (strict) {
    console.error(`File is ${mb} MB — over Telegram's 50 MB bot upload limit. Use --mode link instead.`);
    process.exit(1);
  }
  console.warn(`[sender] File is ${mb} MB — over Telegram's 50 MB limit, falling back to tmpfiles link.`);
  mode = "link";
}

const ok = mode === "document" ? sendDocument() : sendLink();
if (!ok) process.exit(1);
