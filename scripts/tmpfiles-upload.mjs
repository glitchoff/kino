// Upload file to tmpfiles.org — prints download link.
// Usage: node scripts/tmpfiles-upload.mjs <file> [--quiet]
import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";

const file = process.argv[2];
if (!file || !existsSync(file)) { console.error("Usage: node scripts/tmpfiles-upload.mjs <file>"); process.exit(1); }
const quiet = process.argv.includes("--quiet");

const form = new FormData();
form.append("file", new Blob([readFileSync(file)]), basename(file));

const res = await fetch("https://tmpfiles.org/api/v1/upload", { method: "POST", body: form });
const data = await res.json().catch(() => ({}));
if (!res.ok || data.status !== true) { console.error("Upload failed:", data.message || res.statusText); process.exit(1); }

const url = data.data.url;
const dl = url.replace("https://tmpfiles.org/", "https://tmpfiles.org/dl/");
if (!quiet) console.log(`uploaded: ${url}\ndownload: ${dl}`);
else console.log(dl);
