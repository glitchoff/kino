// Telegram poller — send to your chat, get replies while this runs.
// Usage: node scripts/telegram-poller.mjs [--timeout 25] [--once] [--message "hello"]
// Env: reads TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID from process.env or ~/.config/meowscrada/env
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function loadEnv() {
  const envPath = join(homedir(), ".config/meowscrada/env");
  try {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {}
}
loadEnv();

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
if (!TOKEN || !CHAT_ID) {
  console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID (set in env or ~/.config/meowscrada/env)");
  process.exit(1);
}

const args = process.argv.slice(2);
const getArg = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const TIMEOUT = Number(getArg("--timeout", "25"));
const ONCE = args.includes("--once");
const API = `https://api.telegram.org/bot${TOKEN}`;

async function call(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(`${method} failed: ${data.description || res.statusText}`);
  return data.result;
}

async function send(text) {
  return call("sendMessage", { chat_id: CHAT_ID, text });
}
async function sendPoll(question, options) {
  return call("sendPoll", { chat_id: CHAT_ID, question, options, is_anonymous: true });
}

async function pollOnce(offset) {
  return call("getUpdates", { offset, timeout: TIMEOUT, allowed_updates: ["message", "poll_answer"] });
}

function format(update) {
  const msg = update.message;
  if (msg?.text) return { from: msg.from?.first_name ?? "?", text: msg.text };
  if (update.poll_answer) return { from: "poll", text: `poll_answer: ${update.poll_answer.option_ids.join(",")}` };
  return null;
}

export { format, loadEnv };

if (import.meta.url === `file://${process.argv[1]}`) {
  const message = getArg("--message", "🔔 Kino poller online — reply here and I'll get it.");
  if (!args.includes("--no-send")) {
    await send(message);
    await sendPoll("Kino poller test?", ["yes", "no"]);
    console.log("sent message + test poll, now listening…");
  }
  let offset = 0;
  while (true) {
    const updates = await pollOnce(offset);
    for (const u of updates) {
      offset = u.update_id + 1;
      const f = format(u);
      if (f) {
        console.log(`[${f.from}] ${f.text}`);
        if (u.message?.text?.startsWith("/")) console.log("(command not handled) — still logged");
      }
    }
    if (ONCE) break;
  }
}
