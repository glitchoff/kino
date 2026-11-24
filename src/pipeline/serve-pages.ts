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
  canvas { max-width:100%; max-height:100%; border-radius:6px; background:#000; display:none;
    box-shadow:0 18px 48px -12px rgba(0,0,0,.8), 0 0 0 1px var(--ink-400); }

  /* Transport: play button, timecode, timeline. Sits under the stage. */
  .transport { display:none; align-items:center; gap:12px; padding:10px 16px;
    border-top:1px solid var(--ink-400); background:var(--ink-200); flex:0 0 auto; }
  .tc { font-family:ui-monospace,"SF Mono",Menlo,monospace; font-variant-numeric:tabular-nums;
    font-size:12px; color:var(--text-1); min-width:64px; }
  .tc.dim { color:var(--text-3); }
  .track { position:relative; flex:1; height:28px; border-radius:6px;
    background:var(--ink-300); border:1px solid var(--ink-400);
    cursor:pointer; touch-action:none; overflow:hidden; }
  .scenes { position:absolute; inset:0; display:flex; }
  .scene { position:absolute; top:0; bottom:0; border-right:1px solid var(--ink-500); }
  .scene:first-child { border-left:0; }
  .playhead { position:absolute; top:0; bottom:0; width:2px; background:var(--amber);
    margin-left:-1px; pointer-events:none; box-shadow:0 0 6px rgba(217,154,78,.6); }
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

// Declared before any page script runs. The page script and the reload block
// share these, and a \`let\` declared after first use is in the temporal dead
// zone — assigning to it throws a ReferenceError that silently kills the whole
// script, leaving the page stuck on its placeholder.
let bootId = null, busy = false, pending = false;
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
async function pollBoot() {  try {
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
    <span class="hint" id="hint">Building the preview proxy.</span>
    <canvas id="c"></canvas>
  </div>
  <div class="transport" id="transport">
    <button class="act" id="play" title="Play / pause (space)">Play</button>
    <span class="tc" id="tc">00:00.00</span>
    <div class="track" id="track">
      <div class="scenes" id="scenes"></div>
      <div class="playhead" id="head"></div>
    </div>
    <span class="tc dim" id="dur">00:00.00</span>
  </div>`,
    script: `
const c = $("c"), hint = $("hint"), track = $("track"), head = $("head");
const playBtn = $("play"), tc = $("tc"), dur = $("dur"), scenes = $("scenes");
const ctx = c.getContext("2d", { alpha: false });

let W = 0, H = 0, DURATION = 0, FPS = 30;
let playing = false, raf = 0, at = 0, lastTick = 0;
let inFlight = false, queued = null;

function fail(msg) {
  hint.style.display = "block";
  hint.textContent = msg;
  setStatus(msg, true);
}

const fmt = (s) => {
  const m = Math.floor(s / 60), r = s - m * 60;
  return String(m).padStart(2, "0") + ":" + r.toFixed(2).padStart(5, "0");
};

/**
 * Draw the frame at \`t\`.
 *
 * Frames come back as raw rgb24 and are painted with putImageData — a memcpy,
 * no decode. Requests are coalesced: while one is in flight the newest target
 * is remembered, so a fast drag never queues a backlog of stale frames.
 */
async function drawFrame(t) {
  if (inFlight) { queued = t; return; }
  inFlight = true;
  try {
    const r = await fetch("/api/frame?raw=1&t=" + t.toFixed(4), { cache: "no-store" });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      if (d.error) setStatus(d.error, true);
      return;
    }
    const buf = new Uint8Array(await r.arrayBuffer());
    if (!W) {
      W = Number(r.headers.get("X-Frame-Width"));
      H = Number(r.headers.get("X-Frame-Height"));
      c.width = W; c.height = H;
      c.style.aspectRatio = W + " / " + H;
    }
    // Already rgba and already the right length — wrap it, no conversion.
    ctx.putImageData(new ImageData(new Uint8ClampedArray(buf.buffer, buf.byteOffset, W * H * 4), W, H), 0, 0);
  } catch (e) {
    // transient — a drag can outrun the server, which is expected
  } finally {
    inFlight = false;
    if (queued !== null) {
      const q = queued; queued = null;
      drawFrame(q);
    }
  }
}

function seek(t) {
  at = Math.max(0, Math.min(DURATION, t));
  head.style.left = (at / DURATION) * 100 + "%";
  tc.textContent = fmt(at);
  drawFrame(at);
}

function tick(now) {
  if (!playing) return;
  const dt = lastTick ? (now - lastTick) / 1000 : 0;
  lastTick = now;
  seek(at + dt);
  if (at >= DURATION) { setPlaying(false); return; }
  raf = requestAnimationFrame(tick);
}

function setPlaying(on) {
  playing = on;
  playBtn.textContent = on ? "Pause" : "Play";
  lastTick = 0;
  if (on) raf = requestAnimationFrame(tick);
  else cancelAnimationFrame(raf);
}

playBtn.addEventListener("click", () => {
  if (!DURATION) return;
  if (at >= DURATION) at = 0;
  setPlaying(!playing);
});

addEventListener("keydown", (e) => {
  if (e.code === "Space") { e.preventDefault(); playBtn.click(); }
  if (e.code === "ArrowLeft") { setPlaying(false); seek(at - 1 / FPS); }
  if (e.code === "ArrowRight") { setPlaying(false); seek(at + 1 / FPS); }
});

// Drag anywhere on the track to scrub. Pointer capture keeps the drag alive
// when the cursor leaves the track, which is what makes a scrub feel continuous.
let dragging = false;
function scrubTo(e) {
  const r = track.getBoundingClientRect();
  seek(((e.clientX - r.left) / r.width) * DURATION);
}
track.addEventListener("pointerdown", (e) => {
  if (!DURATION) return;
  dragging = true;
  setPlaying(false);
  track.setPointerCapture(e.pointerId);
  scrubTo(e);
});
track.addEventListener("pointermove", (e) => { if (dragging) scrubTo(e); });
track.addEventListener("pointerup", (e) => {
  dragging = false;
  try { track.releasePointerCapture(e.pointerId); } catch {}
});

async function build() {
  busy = true;
  hint.textContent = "Building the preview proxy…";
  setStatus('<span class="live">Building proxy</span>');
  const t0 = performance.now();
  try {
    const res = await fetch("/api/proxy", { method: "POST" });
    const d = await res.json();
    if (!d.success) return fail(d.error || "proxy build failed");

    DURATION = d.duration;
    FPS = d.fps;
    W = d.size.width; H = d.size.height;
    c.width = W; c.height = H;
    c.style.aspectRatio = W + " / " + H;

    hint.style.display = "none";
    c.style.display = "block";
    $("transport").style.display = "flex";
    dur.textContent = fmt(DURATION);

    // Scene markers, so the timeline shows structure instead of one bar.
    scenes.innerHTML = "";
    if (d.scenes && d.scenes.length) {
      for (const s of d.scenes) {
        const m = document.createElement("div");
        m.className = "scene";
        m.style.left = (s.start / DURATION) * 100 + "%";
        m.style.width = (s.duration / DURATION) * 100 + "%";
        m.title = s.id + " — " + s.duration.toFixed(2) + "s";
        scenes.appendChild(m);
      }
    }

    seek(0);

    const wall = Math.round(performance.now() - t0);
    setStatus("Proxy built in <span class='fig'>" + wall + " ms</span>" +
      (d.cacheMs ? " &nbsp;·&nbsp; cached in <span class='fig'>" + d.cacheMs + " ms</span>" : "") +
      (d.cache ? " &nbsp;·&nbsp; <span class='fig'>" + d.cache.frames + "</span> frames, <span class='fig'>" + (d.cache.bytes / 1048576).toFixed(0) + " MB</span>" : "") +
      " &nbsp;·&nbsp; scrub with the timeline or \u2190 \u2192");
  } catch (e) {
    fail("Cannot reach the preview server. Is it still running?");
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
