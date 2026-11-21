/**
 * A voice showcase server: render any line through any engine and voice on
 * demand, and play the results back to back.
 *
 * The point is auditioning. Choosing a TTS voice by reading its name is
 * guessing; choosing it by hearing the actual chapter line in four candidates
 * back to back is not. So the page is built around one text box, one engine
 * selector, one voice list, and a button per candidate.
 *
 * ## What it does not do
 *
 * It does not know what voices exist. Every engine names its own voices, and a
 * hard-coded list would go stale the moment an engine adds one. The caller
 * supplies the catalog — see {@link ShowcaseOptions.engines}.
 *
 * ## Caching
 *
 * Synthesised audio is cached by (engine, voice, rate, text), the same key kino
 * itself uses, so a second render of the same line is instant. That matters
 * because the expensive engines cost tens of seconds per line and an audition
 * means trying many voices on the *same* line.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { synthesizeToWav, type TtsOptions } from "./piper.js";

/** One engine the showcase can drive. */
export interface ShowcaseEngine {
  /** Shown in the selector, and used in the URL. */
  id: string;
  /** Human label, e.g. "Pocket TTS". */
  label: string;
  /** Voice ids this engine accepts. */
  voices: string[];
  /** Options passed to `synthesizeToWav`, minus `voice`. */
  options: Omit<TtsOptions, "voice">;
  /**
   * Extra time this engine needs, in seconds. Used only to set the client's
   * expectation — a 40 s engine and a 1 s one should not look the same while
   * the request is in flight.
   */
  slow?: boolean;
}

export interface ShowcaseOptions {
  engines: ShowcaseEngine[];
  /** Lines offered as one-click presets. The chapter's own dialogue. */
  presets?: string[];
  /**
   * Where saved lines and auditions live. Defaults to `.kino/showcase/` in the
   * cwd — beside the output, never the system temp dir.
   *
   * Two files are kept:
   *
   *   lines.json    every line ever typed, newest first
   *   picks.json    engine+voice+line combinations marked as worth keeping
   *
   * Both are read on start, so a restart does not lose the shortlist.
   */
  dataDir?: string;
  /** Port. Default 4100 — deliberately not the preview's 3333 or 8000. */
  port?: number;
  /** Resolve once listening. */
  quiet?: boolean;
}

/** A saved line: the text plus when it was last used. */
interface SavedLine {
  text: string;
  at: string;
}

/** A shortlisted audition. */
interface Pick {
  engine: string;
  voice: string;
  text: string;
  at: string;
}

const MIME: Record<string, string> = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".json": "application/json",
  ".html": "text/html; charset=utf-8",
};

/**
 * Starts the showcase server and resolves once it is listening.
 *
 * Routes:
 *
 *   GET  /                the audition page
 *   GET  /api/catalog     engines, voices and presets as JSON
 *   GET  /api/say         ?engine=&voice=&text=&rate=  -> audio/wav
 *
 * `/api/say` is a GET so a browser can use it directly as an `<audio src>`,
 * which is what makes a whole grid of candidates playable without any client
 * JavaScript beyond building the elements.
 */
export async function serveShowcase(options: ShowcaseOptions): Promise<{
  url: string;
  /** Where lines.json and picks.json live, for backup or inspection. */
  dataDir: string;
  close: () => Promise<void>;
}> {
  const engines = new Map(options.engines.map((e) => [e.id, e]));
  const port = options.port ?? 4100;
  const presets = options.presets ?? [];

  // Saved lines and picks live beside the output, not in the system temp dir.
  // A showcase session is worth keeping: the shortlist is the decision.
  const dataDir = resolve(options.dataDir ?? join(process.cwd(), ".kino", "showcase"));
  mkdirSync(dataDir, { recursive: true });
  const linesPath = join(dataDir, "lines.json");
  const picksPath = join(dataDir, "picks.json");

  const readJson = <T>(path: string, fallback: T): T => {
    if (!existsSync(path)) return fallback;
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as T;
    } catch {
      // A corrupt save must not stop the server from starting.
      return fallback;
    }
  };

  let lines = readJson<SavedLine[]>(linesPath, []);
  let picks = readJson<Pick[]>(picksPath, []);

  const saveLines = (): void => writeFileSync(linesPath, JSON.stringify(lines, null, 2));
  const savePicks = (): void => writeFileSync(picksPath, JSON.stringify(picks, null, 2));

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);

      if (url.pathname === "/") {
        return send(res, 200, MIME[".html"], renderPage(options, { lines, picks }));
      }

      if (url.pathname === "/api/catalog") {
        return sendJson(res, 200, {
          engines: options.engines.map((e) => ({
            id: e.id,
            label: e.label,
            voices: e.voices,
            slow: Boolean(e.slow),
          })),
          presets,
          lines,
          picks,
        });
      }

      // Saving a line: every audition starts by typing one, so this is the
      // write that matters most.
      if (url.pathname === "/api/lines" && req.method === "POST") {
        const body = await readBody(req);
        const text = String(body.text ?? "").trim();
        if (!text) return sendJson(res, 400, { error: "empty text" });
        lines = [{ text, at: new Date().toISOString() }, ...lines.filter((l) => l.text !== text)].slice(0, 200);
        saveLines();
        return sendJson(res, 200, { lines });
      }

      if (url.pathname === "/api/lines" && req.method === "DELETE") {
        lines = [];
        saveLines();
        return sendJson(res, 200, { lines });
      }

      // Shortlisting: "this voice, on this line, is a candidate."
      if (url.pathname === "/api/picks" && req.method === "POST") {
        const body = await readBody(req);
        const pick: Pick = {
          engine: String(body.engine ?? ""),
          voice: String(body.voice ?? ""),
          text: String(body.text ?? ""),
          at: new Date().toISOString(),
        };
        const dup = picks.findIndex(
          (p) => p.engine === pick.engine && p.voice === pick.voice && p.text === pick.text
        );
        if (dup >= 0) picks.splice(dup, 1);
        else picks = [pick, ...picks].slice(0, 100);
        savePicks();
        return sendJson(res, 200, { picks });
      }

      if (url.pathname === "/api/picks" && req.method === "DELETE") {
        picks = [];
        savePicks();
        return sendJson(res, 200, { picks });
      }

      if (url.pathname === "/api/say") {
        const engineId = url.searchParams.get("engine") ?? "";
        const voice = url.searchParams.get("voice") ?? "";
        const text = url.searchParams.get("text") ?? "";
        const rate = Number(url.searchParams.get("rate") ?? "1");

        const engine = engines.get(engineId);
        if (!engine) return sendJson(res, 404, { error: `unknown engine '${engineId}'` });
        if (!text.trim()) return sendJson(res, 400, { error: "empty text" });
        if (!engine.voices.includes(voice)) {
          return sendJson(res, 400, { error: `engine '${engineId}' has no voice '${voice}'` });
        }

        const started = Date.now();
        const wav = await synthesizeToWav(text, {
          ...engine.options,
          voice,
          rate: Number.isFinite(rate) && rate > 0 ? rate : 1,
        });
        if (!options.quiet) {
          console.log(
            `[showcase] ${engineId}/${voice} ${Date.now() - started} ms  ${JSON.stringify(text.slice(0, 48))}`
          );
        }
        return sendFile(res, wav);
      }

      return sendJson(res, 404, { error: "not found" });
    } catch (err: unknown) {
      const e = err as { message?: string };
      return sendJson(res, 500, { error: e?.message ?? String(err) });
    }
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));

  return {
    url: `http://localhost:${port}`,
    /** Where lines.json and picks.json live, for backup or inspection. */
    dataDir,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

/** Reads a JSON request body. Bounded so a stray upload cannot exhaust memory. */
function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString();
      if (raw.length > 1_000_000) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch {
        reject(new Error("request body is not JSON"));
      }
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, type: string, body: string | Buffer): void {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  send(res, status, MIME[".json"], JSON.stringify(body));
}

function sendFile(res: ServerResponse, path: string): void {
  if (!existsSync(path) || !statSync(path).isFile()) {
    return sendJson(res, 500, { error: "synthesiser wrote no file" });
  }
  const type = MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": statSync(path).size,
    "Cache-Control": "no-store",
  });
  res.end(readFileSync(path));
}

/**
 * The audition page.
 *
 * Deliberately one file, no build step, no framework: it has to work the moment
 * the server starts. The grid is rebuilt whenever the engine changes, so an
 * engine with 27 voices shows 27 players at once.
 */
function renderPage(options: ShowcaseOptions, saved?: { lines?: SavedLine[]; picks?: Pick[] }): string {
  const catalog = {
    engines: options.engines.map((e) => ({
      id: e.id,
      label: e.label,
      voices: e.voices,
      slow: Boolean(e.slow),
    })),
    presets: options.presets ?? [],
    lines: saved?.lines ?? [],
    picks: saved?.picks ?? [],
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>kino · voice showcase</title>
<style>
  :root {
    --ink: #12131a; --paper: #f6f3ea; --dim: #6b6a72;
    --rule: #d8d3c4; --accent: #2b6cb0; --hot: #b83232;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 28px 32px 64px;
    font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    background: var(--paper); color: var(--ink);
  }
  h1 { font-size: 15px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; margin: 0 0 4px; }
  .sub { color: var(--dim); margin: 0 0 24px; font-size: 13px; }
  .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end; margin-bottom: 16px; }
  label { display: block; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--dim); margin-bottom: 4px; }
  select, input[type=text], textarea {
    font: inherit; color: inherit; background: #fff; border: 1px solid var(--rule);
    border-radius: 3px; padding: 7px 9px;
  }
  textarea { width: 100%; min-height: 62px; resize: vertical; }
  button {
    font: inherit; padding: 7px 14px; border-radius: 3px; cursor: pointer;
    border: 1px solid var(--rule); background: #fff; color: var(--ink);
  }
  button:hover { border-color: var(--accent); color: var(--accent); }
  button.primary { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  button.primary:hover { background: var(--accent); border-color: var(--accent); color: #fff; }
  .presets button { font-size: 12px; padding: 4px 9px; margin: 0 6px 6px 0; }
  .h2 { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--dim);
        margin: 26px 0 8px; font-weight: 600; border-top: 1px solid var(--rule); padding-top: 16px; }
  .picks { display: flex; flex-wrap: wrap; gap: 8px; }
  .pick { border: 1px solid var(--rule); border-radius: 3px; background: #fff; padding: 6px 10px; font-size: 12px; display: flex; align-items: center; gap: 8px; }
  .pick b { font-weight: 600; }
  .pick button { padding: 2px 7px; font-size: 11px; }
  .star { border: none; background: none; font-size: 15px; line-height: 1; cursor: pointer; color: var(--rule); padding: 0 2px; }
  .star.on { color: #d69b1e; }
  .star:hover { color: #d69b1e; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; margin-top: 20px; }
  .card { border: 1px solid var(--rule); border-radius: 4px; background: #fff; padding: 10px 12px; }
  .card h3 { margin: 0 0 8px; font-size: 13px; font-weight: 600; display: flex; justify-content: space-between; }
  .card audio { width: 100%; height: 32px; }
  .meta { font-size: 11px; color: var(--dim); margin-top: 6px; min-height: 15px; }
  .meta.err { color: var(--hot); }
  .hint { font-size: 12px; color: var(--dim); }
  .spinner { display: inline-block; width: 10px; height: 10px; border: 2px solid var(--rule); border-top-color: var(--accent); border-radius: 50%; animation: spin .7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <h1>voice showcase</h1>
  <p class="sub">Any line, any engine, any voice — rendered on demand. Slow engines are marked.</p>

  <div class="row">
    <div>
      <label for="engine">engine</label>
      <select id="engine"></select>
    </div>
    <div>
      <label for="rate">rate</label>
      <input id="rate" type="text" value="1" size="4">
    </div>
    <div>
      <button class="primary" id="render">render all voices</button>
    </div>
    <div class="hint" id="hint"></div>
  </div>

  <label for="text">line</label>
  <textarea id="text"></textarea>
  <div class="row" style="margin-top:10px; margin-bottom:0">
    <button id="save">save line</button>
    <button id="clear-lines">clear saved</button>
    <span class="hint" id="saved-hint"></span>
  </div>
  <div class="presets" id="presets" style="margin-top:10px"></div>

  <h2 class="h2">shortlist</h2>
  <div id="picks" class="picks"></div>

  <div class="grid" id="grid"></div>

<script>
const CATALOG = ${JSON.stringify(catalog)};
const $ = (id) => document.getElementById(id);
const engineSel = $("engine");
const textEl = $("text");
const grid = $("grid");
const hint = $("hint");

let savedLines = CATALOG.lines || [];
let picks = CATALOG.picks || [];

for (const e of CATALOG.engines) {
  const o = document.createElement("option");
  o.value = e.id;
  o.textContent = e.label + (e.slow ? "  (slow)" : "") + "  · " + e.voices.length + " voices";
  engineSel.appendChild(o);
}

function renderPresets() {
  const box = $("presets");
  box.innerHTML = "";
  // Chapter lines first, then anything the user saved.
  const all = [...CATALOG.presets, ...savedLines.map((l) => l.text)];
  const seen = new Set();
  for (const p of all) {
    if (seen.has(p)) continue;
    seen.add(p);
    const b = document.createElement("button");
    b.textContent = p.length > 46 ? p.slice(0, 44) + "…" : p;
    b.title = p;
    b.onclick = () => { textEl.value = p; };
    box.appendChild(b);
  }
  $("saved-hint").textContent = savedLines.length
    ? savedLines.length + " saved line" + (savedLines.length === 1 ? "" : "s")
    : "no saved lines yet";
}

function currentEngine() {
  return CATALOG.engines.find((e) => e.id === engineSel.value);
}

function isPicked(engine, voice, text) {
  return picks.some((p) => p.engine === engine && p.voice === voice && p.text === text);
}

async function togglePick(engine, voice, text) {
  const r = await fetch("/api/picks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ engine, voice, text }),
  });
  const j = await r.json();
  picks = j.picks || [];
  renderPicks();
  build();
}

function renderPicks() {
  const box = $("picks");
  box.innerHTML = "";
  if (!picks.length) {
    box.innerHTML = '<span class="hint">Star a candidate to keep it across restarts.</span>';
    return;
  }
  for (const p of picks) {
    const el = document.createElement("div");
    el.className = "pick";
    const label = document.createElement("span");
    label.innerHTML = "<b>" + p.voice + "</b> · " + p.engine + " · " + (p.text.length > 34 ? p.text.slice(0, 32) + "…" : p.text);
    label.title = p.text;
    const play = document.createElement("button");
    play.textContent = "▶";
    const audio = new Audio();
    play.onclick = () => {
      audio.src = "/api/say?engine=" + encodeURIComponent(p.engine)
        + "&voice=" + encodeURIComponent(p.voice)
        + "&text=" + encodeURIComponent(p.text);
      audio.play();
    };
    const del = document.createElement("button");
    del.textContent = "×";
    del.onclick = () => togglePick(p.engine, p.voice, p.text);
    el.append(label, play, del);
    box.appendChild(el);
  }
}

function build() {
  grid.innerHTML = "";
  const engine = currentEngine();
  hint.textContent = engine.slow
    ? "This engine needs tens of seconds per line — results appear as they finish."
    : "";
  for (const voice of engine.voices) {
    const card = document.createElement("div");
    card.className = "card";
    const h = document.createElement("h3");
    const name = document.createElement("span");
    name.textContent = voice;
    const star = document.createElement("button");
    star.className = "star" + (isPicked(engine.id, voice, textEl.value) ? " on" : "");
    star.textContent = "★";
    star.title = "shortlist this voice for the current line";
    star.onclick = () => togglePick(engine.id, voice, textEl.value);
    h.append(name, star);
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "none";
    const meta = document.createElement("div");
    meta.className = "meta";
    card.append(h, audio, meta);
    grid.appendChild(card);
    card._voice = voice;
    card._audio = audio;
    card._meta = meta;
  }
}

async function renderAll() {
  const engine = currentEngine();
  const text = textEl.value;
  const rate = $("rate").value || "1";
  for (const card of grid.children) {
    const voice = card._voice;
    const audio = card._audio;
    const meta = card._meta;
    const url = "/api/say?engine=" + encodeURIComponent(engine.id)
      + "&voice=" + encodeURIComponent(voice)
      + "&rate=" + encodeURIComponent(rate)
      + "&text=" + encodeURIComponent(text);
    meta.className = "meta";
    meta.innerHTML = '<span class="spinner"></span> rendering…';
    audio.preload = "auto";
    audio.src = url;
    const t0 = performance.now();
    audio.addEventListener("loadedmetadata", () => {
      meta.textContent = ((performance.now() - t0) / 1000).toFixed(1) + " s · " + audio.duration.toFixed(2) + " s audio";
    }, { once: true });
    audio.addEventListener("error", () => {
      meta.className = "meta err";
      meta.textContent = "failed";
    }, { once: true });
  }
}

async function saveLine() {
  const text = textEl.value.trim();
  if (!text) return;
  const r = await fetch("/api/lines", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const j = await r.json();
  savedLines = j.lines || [];
  renderPresets();
}

engineSel.onchange = build;
$("render").onclick = renderAll;
$("save").onclick = saveLine;
$("clear-lines").onclick = async () => {
  const r = await fetch("/api/lines", { method: "DELETE" });
  const j = await r.json();
  savedLines = j.lines || [];
  renderPresets();
};
renderPresets();
renderPicks();
build();
</script>
</body>
</html>`;
}
