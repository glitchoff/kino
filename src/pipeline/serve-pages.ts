/**
 * Shared page chrome.
 *
 * The two pages differ only in their body and script: the preview plays a proxy,
 * the render page produces the final file. Everything else â€” the palette, the
 * type, the timecode â€” is the same so the two read as one tool.
 */
function shell(opts: { title: string; nav: string; body: string; script: string; reload: boolean }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${opts.title}</title>
<style>
  :root {
    color-scheme: dark;
    --ink-000:#0a0a0b; --ink-100:#111112; --ink-200:#17171a; --ink-300:#1f1f23;
    --ink-400:#2a2a30; --ink-500:#3a3a42;
    --text-1:#e8e6e2; --text-2:#9a9791; --text-3:#6b6862;
    --amber:#d99a4e; --red:#c86a5e;
  }
  * { box-sizing: border-box; }
  body {
    margin:0; height:100vh; display:flex; flex-direction:column;
    font:13px/1.5 Inter, ui-sans-serif, system-ui, sans-serif;
    background:var(--ink-100); color:var(--text-1); overflow:hidden;
    -webkit-font-smoothing:antialiased;
  }
  header { display:flex; align-items:center; gap:16px; height:48px; padding:0 16px;
    border-bottom:1px solid var(--ink-400); flex:0 0 auto; }
  .title { margin:0; font-size:13px; font-weight:500; color:var(--text-2); }
  nav { display:flex; gap:4px; }
  nav a { color:var(--text-3); text-decoration:none; padding:6px 12px; border-radius:6px;
    transition:color .12s ease, background-color .12s ease; }
  nav a:hover { color:var(--text-2); }
  nav a.on { color:var(--text-1); background:var(--ink-300); }
  .spacer { margin-left:auto; }
  button.act { background:var(--ink-300); color:var(--text-1); border:1px solid var(--ink-500);
    border-radius:8px; padding:6px 12px; font:inherit; cursor:pointer;
    transition:background-color .12s ease, border-color .12s ease; }
  button.act:hover:not(:disabled) { border-color:#4a4a54; }
  button.act:disabled { opacity:.4; cursor:default; }
  button.primary { background:var(--text-1); border-color:var(--text-1); color:#121214; font-weight:500; }
  button.primary:hover:not(:disabled) { background:#f4f2ee; border-color:#f4f2ee; }
  .stage { flex:1; min-height:0; display:grid; place-items:center; padding:24px;
    background:var(--ink-000); }
  video { max-width:100%; max-height:100%; border-radius:6px; background:#000; display:none;
    box-shadow:0 18px 48px -12px rgba(0,0,0,.8), 0 0 0 1px var(--ink-400); }
  .hint { color:var(--text-3); font-size:13px; text-align:center; max-width:38ch; line-height:1.6; }
  .status { padding:12px 16px; border-top:1px solid var(--ink-400); color:var(--text-3);
    min-height:44px; flex:0 0 auto; font-size:12px; display:flex; align-items:center; gap:8px; }
  .status.err { color:var(--red); white-space:pre-wrap; align-items:flex-start; }
  .status .fig { font-family:ui-monospace,"SF Mono",Menlo,monospace;
    font-variant-numeric:tabular-nums; color:var(--text-1); }
  .status .live { color:var(--amber); }
</style>
</head>
<body>
  <header>
    <p class="title">Kino</p>
    <nav>${opts.nav}</nav>
    <span class="spacer"></span>
    ${opts.body.includes("<!--actions-->") ? "" : ""}
  </header>
  ${opts.body}
  <div class="status" id="st">Ready</div>
<script>
const $ = (id) => document.getElementById(id);
const st = $("st");
function setStatus(html, isErr) {
  st.className = "status" + (isErr ? " err" : "");
  st.innerHTML = html;
}
${opts.script}
${opts.reload ? liveReload() : ""}
</script>
</body>
</html>`;
}

/**
 * Poll the boot id and reload when it moves.
 *
 * A watcher restarts the process on a source change; the page has no other way
 * to know the code moved on. Polling an 8-byte response beats holding an SSE
 * stream open, because a restart kills the stream and telling "restarted" apart
 * from "network blipped" is more code than this.
 */
function liveReload(): string {
  return `
let bootId = null, busy = false, pending = false;
async function pollBoot() {
  try {
    const { bootId: id } = await (await fetch("/api/boot", { cache: "no-store" })).json();
    if (bootId === null) bootId = id;
    else if (id !== bootId) {
      if (busy) pending = true; else location.reload();
      return;
    }
  } catch {}
  setTimeout(pollBoot, 1000);
}
pollBoot();`;
}

/**
 * The preview page: a player.
 *
 * It plays the proxy, which is a real all-keyframe mp4. Playback is smooth
 * because the browser is decoding a video file, and seeking is instant because
 * every frame is a keyframe. Nothing is re-rendered while you watch.
 */
export function previewPage(reload: boolean): string {
  return shell({
    title: "Kino preview",
    nav: `<a href="/" class="on">Preview</a><a href="/render">Render</a>`,
    body: `
  <div class="stage">
    <span class="hint" id="hint">Building the preview proxy.<br>
      This happens once per change; after that, playback and scrubbing are instant.</span>
    <video id="v" controls playsinline></video>
  </div>`,
    script: `
const v = $("v"), hint = $("hint");

async function build() {
  busy = true;
  setStatus('<span class="live">Building proxy</span>');
  const t0 = performance.now();
  try {
    const d = await (await fetch("/api/proxy", { method: "POST" })).json();
    if (!d.success) return setStatus(d.error, true);

    hint.style.display = "none";
    v.style.display = "block";
    v.src = "/api/proxy.mp4?v=" + Date.now();
    v.play().catch(() => {});

    const wall = Math.round(performance.now() - t0);
    setStatus("Proxy built in <span class='fig'>" + wall + " ms</span> â€” " +
      d.duration.toFixed(2) + "s at " + d.fps + " fps");
  } catch (e) {
    setStatus(String(e), true);
  } finally {
    busy = false;
    if (pending) location.reload();
  }
}

build();`,
    reload,
  });
}

/**
 * The render page: produces the final file.
 *
 * Deliberately separate from the preview. This is the deliverable at full
 * quality, not a proxy, and it is slow on purpose â€” it is the export.
 */
export function renderPage(reload: boolean): string {
  return shell({
    title: "Kino render",
    nav: `<a href="/">Preview</a><a href="/render" class="on">Render</a>`,
    body: `
  <div class="stage">
    <span class="hint" id="hint">Press Render to produce the final video.</span>
    <video id="v" controls playsinline></video>
  </div>`,
    script: `
const v = $("v"), hint = $("hint");

const btn = document.createElement("button");
btn.className = "act primary";
btn.textContent = "Render";
btn.style.marginLeft = "auto";
btn.addEventListener("click", async () => {
  btn.disabled = true;
  busy = true;
  setStatus('<span class="live">Rendering</span>');
  const t0 = performance.now();
  try {
    const d = await (await fetch("/api/render", { method: "POST" })).json();
    if (!d.success) return setStatus(d.error, true);

    hint.style.display = "none";
    v.style.display = "block";
    v.src = d.url;

    const wall = Math.round(performance.now() - t0);
    setStatus("Rendered in <span class='fig'>" + wall + " ms</span>" +
      " &nbsp;Â·&nbsp; reused <span class='fig'>" + d.reused + "</span>" +
      " &nbsp;Â·&nbsp; rendered <span class='fig'>" + d.rendered + "</span>");
  } catch (e) {
    setStatus(String(e), true);
  } finally {
    btn.disabled = false;
    busy = false;
    if (pending) location.reload();
  }
});
document.querySelector("header").appendChild(btn);`,
    reload,
  });
}
