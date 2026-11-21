/**
 * The audition page.
 *
 * One job: type a line, pick a voice, press OK, and the player appears below.
 * No take sheet, no shortlist, no counters — those were scaffolding around a
 * screen that only needs to answer "does this voice sound right".
 *
 * The script below is deliberately small. Every line of it is something a
 * person would notice if it broke, which is the test the last version failed:
 * a single bad escape in a template literal killed the whole script and left
 * two empty dropdowns. `scripts/showcase/verify-page.mjs` parses and runs this
 * against a DOM shim before anyone is told it works.
 */

export interface PageEngine {
  id: string;
  label: string;
  voices: string[];
  slow: boolean;
}

export interface PageLine {
  id: number;
  text: string;
  at: string;
}

export interface PagePick {
  id: number;
  engine: string;
  voice: string;
  text: string;
  at: string;
}

export interface PageData {
  engines: PageEngine[];
  presets: string[];
  lines: PageLine[];
  picks: PagePick[];
}

export function renderPage(data: PageData): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>kino · tts</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400&family=Inter:wght@400;500&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet">
<style>
  :root {
    --paper:   #f2ede2;
    --surface: #fbf8f1;
    --ink:     #1c1a16;
    --ink-2:   #55514a;
    --ink-3:   #8a847a;
    --rule:    rgba(28, 26, 22, .12);
    --rule-2:  rgba(28, 26, 22, .06);
    --accent:  #a8601a;
    --live:    #b0431f;
    --mono: "JetBrains Mono", ui-monospace, Menlo, monospace;
    --sans: "Inter", ui-sans-serif, system-ui, sans-serif;
    --serif: "Newsreader", ui-serif, Georgia, serif;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    background: var(--paper); color: var(--ink);
    font: 400 14px/1.55 var(--sans);
    -webkit-font-smoothing: antialiased;
    min-height: 100vh;
  }
  .wrap { max-width: 720px; margin: 0 auto; padding: 40px 24px 64px; }

  .brand { display: flex; align-items: baseline; gap: 8px; margin-bottom: 28px; }
  .brand .word { font: 400 17px/1 var(--serif); }
  .brand .tag { font: 400 11px/1 var(--mono); color: var(--ink-3); }

  .panel {
    background: var(--surface); border: 1px solid var(--rule);
    border-radius: 12px; padding: 16px;
    display: flex; flex-direction: column; gap: 12px;
  }

  textarea {
    width: 100%; min-height: 84px; resize: vertical;
    font: 400 16px/1.5 var(--serif); color: var(--ink);
    background: none; border: 0; padding: 0; outline: none;
  }
  textarea::placeholder { color: var(--ink-3); }

  .row {
    display: flex; align-items: flex-end; gap: 12px;
    border-top: 1px solid var(--rule-2); padding-top: 12px;
  }
  .field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .field > span { font: 400 11px/1 var(--mono); color: var(--ink-3); }

  select {
    width: 100%;
    font: 400 13px/1.4 var(--sans); color: var(--ink);
    background: var(--paper); border: 1px solid var(--rule);
    border-radius: 8px; padding: 8px 9px; outline: none;
  }
  select:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(168,96,26,.14); }

  button {
    font: 500 13px/1 var(--sans); color: var(--paper);
    background: var(--ink); border: 1px solid var(--ink);
    border-radius: 8px; padding: 0 22px; height: 36px;
    cursor: pointer;
    transition: background-color 120ms ease, border-color 120ms ease;
  }
  button:hover { background: #000; border-color: #000; }
  button:disabled { opacity: .45; cursor: default; }

  /* The result: one player, nothing else. */
  .result { margin-top: 20px; display: none; }
  .result.show { display: block; }
  .result audio { width: 100%; height: 40px; }
  .meta {
    display: flex; align-items: center; gap: 10px;
    margin-top: 8px; font: 400 12px/1 var(--mono); color: var(--ink-3);
  }
  .meta .lamp {
    width: 7px; height: 7px; border-radius: 50%; background: var(--rule);
    transition: background-color 160ms ease;
  }
  .meta .lamp.on { background: var(--live); }
  .meta.err { color: var(--live); }

  .lines { margin-top: 28px; }
  .lines h2 { font: 400 11px/1 var(--mono); color: var(--ink-3); margin: 0 0 8px; }
  .line-row { display: flex; align-items: center; border-radius: 6px; }
  .line-row:hover { background: var(--surface); }
  .line-btn {
    flex: 1; min-width: 0; text-align: left;
    font: 400 13px/1.4 var(--sans); color: var(--ink-2);
    background: none; border: 0; border-radius: 6px;
    padding: 6px 8px; cursor: pointer;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .line-btn:hover { color: var(--ink); }
  .line-del {
    display: none; flex: 0 0 22px; width: 22px; height: 22px;
    align-items: center; justify-content: center;
    background: none; border: 0; border-radius: 4px;
    color: var(--ink-3); cursor: pointer; font-size: 14px; line-height: 1; padding: 0;
  }
  .line-row:hover .line-del { display: flex; }
  .line-del:hover { color: var(--live); background: rgba(176,67,31,.1); }
  .empty { font: 400 13px/1.5 var(--sans); color: var(--ink-3); padding: 6px 8px; }

  .foot { margin-top: 12px; display: flex; gap: 8px; }
  .foot button {
    background: none; color: var(--ink-3); border-color: var(--rule);
    height: 30px; padding: 0 12px; font-weight: 400; font-size: 12px;
  }
  .foot button:hover { background: var(--surface); color: var(--ink); border-color: var(--rule); }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand"><span class="word">kino</span><span class="tag">tts</span></div>

  <div class="panel">
    <textarea id="text" placeholder="Type the line" aria-label="line"></textarea>
    <div class="row">
      <div class="field">
        <span>model</span>
        <select id="engine"></select>
      </div>
      <div class="field">
        <span>voice</span>
        <select id="voice"></select>
      </div>
      <button id="ok">OK</button>
    </div>
  </div>

  <div class="result" id="result">
    <audio id="player" controls></audio>
    <div class="meta" id="meta"><span class="lamp" id="lamp"></span><span id="metatext"></span></div>
  </div>

  <div class="lines">
    <h2>history</h2>
    <div id="history"></div>
  </div>

  <div class="lines">
    <h2>saved lines</h2>
    <div id="presets"></div>
    <div class="foot">
      <button id="save">save line</button>
      <button id="clear">clear saved</button>
    </div>
  </div>
</div>

<script>
const DATA = ${JSON.stringify(data)};
const $ = (id) => document.getElementById(id);

let lines = DATA.lines || [];

for (const e of DATA.engines) {
  const o = document.createElement("option");
  o.value = e.id;
  o.textContent = e.label;
  $("engine").appendChild(o);
}

function engine() {
  return DATA.engines.find((e) => e.id === $("engine").value) || DATA.engines[0];
}

function fillVoices() {
  const sel = $("voice");
  sel.innerHTML = "";
  for (const v of engine().voices) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    sel.appendChild(o);
  }
}

function setMeta(text, bad) {
  $("metatext").textContent = text;
  $("meta").className = bad ? "meta err" : "meta";
}

/* OK: render the line in the chosen voice and show the player. */
async function ok() {
  const text = $("text").value.trim();
  if (!text) { setMeta("type a line first", true); $("result").classList.add("show"); return; }

  // A new render replaces the old one: stop whatever is playing first.
  $("player").pause();
  $("player").removeAttribute("src");
  $("lamp").classList.remove("on");

  const btn = $("ok");
  btn.disabled = true;
  $("result").classList.add("show");
  setMeta("rendering…", false);

  const voice = $("voice").value;
  const url = "/api/say?engine=" + encodeURIComponent(engine().id)
    + "&voice=" + encodeURIComponent(voice)
    + "&text=" + encodeURIComponent(text);

  const t0 = performance.now();
  try {
    const r = await fetch(url);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setMeta(String(j.error || "render failed").split("\\n")[0].slice(0, 160), true);
      return;
    }
    const blob = await r.blob();
    const ms = ((performance.now() - t0) / 1000).toFixed(1);
    $("player").src = URL.createObjectURL(blob);
    $("lamp").classList.add("on");
    $("player").onended = () => $("lamp").classList.remove("on");
    setMeta(ms + "s · " + (blob.size / 1024).toFixed(0) + " KB", false);
    $("player").play().catch(() => {});
    // Keep this clip in the session list, newest first.
    history.unshift({ url: $("player").src, voice, engine: engine().label, text, size: blob.size });
    renderHistory();
  } catch (e) {
    setMeta(String(e.message || e), true);
  } finally {
    btn.disabled = false;
  }
}

/* Session history: the clips rendered since the page loaded. Not saved. */
const history = [];

function renderHistory() {
  const box = $("history");
  box.innerHTML = "";
  if (!history.length) {
    box.innerHTML = '<div class="empty">nothing rendered yet</div>';
    return;
  }
  for (const h of history) {
    const row = document.createElement("div");
    row.className = "line-row";

    const b = document.createElement("button");
    b.className = "line-btn";
    b.textContent = h.voice + " · " + h.text;
    b.title = h.text;
    b.onclick = () => {
      // Play a past clip. Same rule: one at a time.
      $("player").pause();
      $("player").src = h.url;
      $("player").play().catch(() => {});
      $("result").classList.add("show");
      setMeta(h.engine + " · " + (h.size / 1024).toFixed(0) + " KB", false);
    };

    const d = document.createElement("button");
    d.className = "line-del";
    d.textContent = "×";
    d.title = "remove";
    d.onclick = () => {
      const i = history.indexOf(h);
      if (i >= 0) history.splice(i, 1);
      renderHistory();
    };

    row.append(b, d);
    box.appendChild(row);
  }
}

function renderLines() {
  const box = $("presets");
  box.innerHTML = "";
  const seen = new Set();
  const all = [];
  for (const p of DATA.presets) all.push({ text: p, id: null });
  for (const l of lines) all.push({ text: l.text, id: l.id });
  for (const item of all) {
    if (seen.has(item.text)) continue;
    seen.add(item.text);
    const row = document.createElement("div");
    row.className = "line-row";
    const b = document.createElement("button");
    b.className = "line-btn";
    b.textContent = item.text;
    b.title = item.text;
    b.onclick = () => { $("text").value = item.text; $("text").focus(); };
    row.appendChild(b);
    if (item.id !== null) {
      const d = document.createElement("button");
      d.className = "line-del";
      d.textContent = "×";
      d.title = "delete";
      d.onclick = async () => {
        const r = await fetch("/api/lines/" + item.id, { method: "DELETE" });
        const j = await r.json();
        lines = j.lines || [];
        renderLines();
      };
      row.appendChild(d);
    }
    box.appendChild(row);
  }
  if (!seen.size) box.innerHTML = '<div class="empty">none yet</div>';
}

async function saveLine() {
  const text = $("text").value.trim();
  if (!text) return;
  const r = await fetch("/api/lines", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const j = await r.json();
  lines = j.lines || [];
  renderLines();
}

$("engine").onchange = fillVoices;
$("ok").onclick = ok;
$("save").onclick = saveLine;
$("clear").onclick = async () => {
  const r = await fetch("/api/lines", { method: "DELETE" });
  const j = await r.json();
  lines = j.lines || [];
  renderLines();
};
$("text").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); ok(); }
});

$("text").value = DATA.presets[0] || "";
fillVoices();
renderLines();
renderHistory();
</script>
</body>
</html>`;
}
