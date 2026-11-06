// CLI to message your Telegram chat.
// Usage:
//   node scripts/telegram-send.mjs "hello there"
//   node scripts/telegram-send.mjs --file out/bridge.mp4 --caption "bridge render done"
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (from env or ~/.config/meowscrada/env)
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";

function loadEnv() {
  try {
    for (const line of readFileSync(join(homedir(), ".config/meowscrada/env"), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {}
}
loadEnv();
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
if (!TOKEN || !CHAT_ID) { console.error("Missing TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID"); process.exit(1); }
const API = `https://api.telegram.org/bot${TOKEN}`;

const args = process.argv.slice(2);
const getArg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const file = getArg("--file");
const caption = getArg("--caption") || "";
const text = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--file" && args[i - 1] !== "--caption").join(" ").trim();

async function postJson(method, body) {
  const r = await fetch(`${API}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.ok) throw new Error(d.description || r.statusText);
  return d.result;
}

if (file) {
  if (!existsSync(file)) { console.error(`file not found: ${file}`); process.exit(1); }
  const form = new FormData();
  form.append("chat_id", String(CHAT_ID));
  form.append("caption", caption || text);
  form.append("document", new Blob([readFileSync(file)]), basename(file));
  const r = await fetch(`${API}/sendDocument`, { method: "POST", body: form });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.ok) { console.error(d.description || r.statusText); process.exit(1); }
  console.log(`sent file ${file}`);
} else if (text) {
  await postJson("sendMessage", { chat_id: CHAT_ID, text });
  console.log("sent message");
} else {
  console.error('Usage: node scripts/telegram-send.mjs "hello"  |  node scripts/telegram-send.mjs --file out.mp4 --caption "done"');
  process.exit(1);
}
