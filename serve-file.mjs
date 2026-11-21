// Serve a file over HTTP with range support, so a <video> can seek it.
//
// Used to watch a render that is still being written. An mp4 only becomes
// seekable once its `moov` atom is complete, which for a normal (non-fragmented)
// encode happens at the end — so mid-render the browser can often play from the
// start but cannot scrub. That is a property of the file, not of this server.
import { createReadStream, statSync, existsSync } from "node:fs";
import { createServer } from "node:http";

const FILE = process.argv[2];
const PORT = Number(process.argv[3] ?? 8000);

if (!FILE) {
  console.error("usage: node serve-file.mjs <file> [port]");
  process.exit(1);
}

const types = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
};

const typeFor = (p) => {
  const m = /\.[^.]+$/.exec(p);
  return (m && types[m[0].toLowerCase()]) || "application/octet-stream";
};

const page = (name) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${name}</title>
<style>
  body{margin:0;height:100vh;display:grid;place-items:center;background:#0a0a0b;color:#e8e6e2;
       font:13px/1.5 Inter,system-ui,sans-serif}
  .wrap{width:min(96vw,1400px)}
  video{width:100%;max-height:82vh;background:#000;border-radius:6px;display:block}
  .bar{display:flex;gap:12px;align-items:center;margin-top:10px;color:#9a9791}
  .fig{font-family:ui-monospace,Menlo,monospace;color:#e8e6e2}
  button{background:#1f1f23;color:#e8e6e2;border:1px solid #3a3a42;border-radius:6px;
         padding:5px 11px;font:inherit;cursor:pointer}
</style></head>
<body><div class="wrap">
  <video id="v" controls playsinline preload="metadata" src="/file"></video>
  <div class="bar">
    <button id="r">Reload</button>
    <span id="s">size: …</span>
    <span style="margin-left:auto">serving <span class="fig">${name}</span></span>
  </div>
</div>
<script>
const v = document.getElementById("v"), s = document.getElementById("s");
v.addEventListener("error", () => {
  s.textContent = "video error — the file is probably still being written (no moov atom yet)";
});
async function size() {
  try {
    const r = await fetch("/size", { cache: "no-store" });
    const d = await r.json();
    s.textContent = "size: " + (d.bytes / 1048576).toFixed(1) + " MB · updated " + d.ago + "s ago";
  } catch {}
}
document.getElementById("r").onclick = () => {
  v.src = "/file?v=" + Date.now();
  v.load();
};
size();
setInterval(size, 3000);
</script>
</body></html>`;

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (url.pathname === "/size") {
    try {
      const st = statSync(FILE);
      const ago = Math.max(0, Math.round((Date.now() - st.mtimeMs) / 1000));
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ bytes: st.size, ago }));
    } catch {
      res.writeHead(404).end("{}");
    }
    return;
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    const name = FILE.split(/[\\/]/).pop();
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(page(name));
    return;
  }

  if (url.pathname !== "/file") {
    res.writeHead(404).end("not found");
    return;
  }

  if (!existsSync(FILE)) {
    res.writeHead(404).end("file not found");
    return;
  }

  const { size } = statSync(FILE);
  const range = req.headers.range;

  if (!range) {
    res.writeHead(200, {
      "Content-Type": typeFor(FILE),
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    });
    createReadStream(FILE).pipe(res);
    return;
  }

  const m = /bytes=(\d*)-(\d*)/.exec(range);
  const start = m?.[1] ? Number(m[1]) : 0;
  const end = m?.[2] ? Number(m[2]) : size - 1;

  if (start >= size || start > end) {
    res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
    return;
  }

  res.writeHead(206, {
    "Content-Type": typeFor(FILE),
    "Content-Length": String(end - start + 1),
    "Content-Range": `bytes ${start}-${end}/${size}`,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  });
  createReadStream(FILE, { start, end }).pipe(res);
}).listen(PORT, () => {
  console.log(`serving ${FILE}`);
  console.log(`  http://localhost:${PORT}/`);
});
