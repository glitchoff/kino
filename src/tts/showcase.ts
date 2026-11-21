/**
 * A voice showcase server: render any line through any engine and voice on
 * demand, and audition the results one at a time.
 *
 * The point is auditioning. Choosing a TTS voice by reading its name is
 * guessing; hearing the actual chapter line in candidates back to back is not.
 *
 * ## What it does not do
 *
 * It does not know what voices exist. Every engine names its own, and a
 * hard-coded list would go stale the moment an engine adds one. The caller
 * supplies the catalog — see {@link ShowcaseOptions.engines}.
 *
 * ## Persistence
 *
 * SQLite (`node:sqlite`, built into Node 22.5+), in `.kino/showcase/` beside the
 * output. Lines, shortlisted picks and every take's render time are rows, so
 * the screen can restore itself and the delete UI is a DELETE rather than a
 * rewrite of a JSON file.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { synthesizeToWav, type TtsOptions } from "./piper.js";
import { ShowcaseDb } from "./showcase-db.js";
import { renderPage } from "./showcase-page.js";

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
   * Call an HTTP TTS server instead of spawning a command.
   *
   * Some engines ship a server rather than a CLI — Pocket TTS has a FastAPI
   * app at `POST /tts` taking `text` and `voice_url`. Using that means no
   * adapter script has to live in the composition's project, which is the
   * difference between working now and waiting on a file kino cannot write.
   *
   * The response is saved verbatim, so whatever audio format the server
   * returns is what the browser gets; set {@link format} to match.
   */
  http?: {
    /** Full URL of the synthesis endpoint. */
    url: string;
    /** Form field names. Defaults are `text` and `voice`. */
    textField?: string;
    voiceField?: string;
    /** Extra form fields, e.g. a model name. */
    fields?: Record<string, string>;
  };
  /**
   * Extra time this engine needs, in seconds. Used only to set the client's
   * expectation — a 40 s engine and a 1 s one should not look the same while
   * the request is in flight.
   */
  slow?: boolean;
  /**
   * What the engine writes. kino's `command` engine renames its `.part.wav`
   * staging file to `{out}` regardless, so the extension in the URL is
   * cosmetic — but the *content* is not, and the browser needs the right
   * Content-Type to decode it.
   */
  format?: "wav" | "mp3";
}

export interface ShowcaseOptions {
  engines: ShowcaseEngine[];
  /** Lines offered as one-click presets. The chapter's own dialogue. */
  presets?: string[];
  /**
   * Where the database lives. Defaults to `.kino/showcase/` in the cwd — beside
   * the output, never the system temp dir.
   */
  dataDir?: string;
  /** Port. Default 4100 — deliberately not the preview's 3333 or 8000. */
  port?: number;
  /** Resolve once listening. */
  quiet?: boolean;
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
 *   GET    /                the audition page
 *   GET    /api/catalog     engines, voices, presets, lines, picks
 *   GET    /api/say         ?engine=&voice=&text=&rate=  -> audio/wav
 *   POST   /api/takes       record a render, returns its id
 *   PATCH  /api/takes/:id   { seconds } once the browser knows the length
 *   DELETE /api/takes/:id   forget one take
 *   GET    /api/lines       saved lines
 *   POST   /api/lines       { text }
 *   DELETE /api/lines/:id   remove one saved line
 *   GET    /api/picks       shortlist
 *   POST   /api/picks       { engine, voice, text } — toggles
 *   DELETE /api/picks/:id   remove one pick
 */
export async function serveShowcase(options: ShowcaseOptions): Promise<{
  url: string;
  /** Where the database lives, for backup or inspection. */
  dataDir: string;
  close: () => Promise<void>;
}> {
  const engines = new Map(options.engines.map((e) => [e.id, e]));
  const port = options.port ?? 4100;
  const presets = options.presets ?? [];

  const dataDir = resolve(options.dataDir ?? join(process.cwd(), ".kino", "showcase"));
  const db = new ShowcaseDb(dataDir);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      const path = url.pathname;
      const idMatch = /^\/(api\/(?:takes|lines|picks))\/(\d+)$/.exec(path);

      if (path === "/") {
        return send(
          res,
          200,
          MIME[".html"],
          renderPage({
            engines: options.engines.map((e) => ({
              id: e.id,
              label: e.label,
              voices: e.voices,
              slow: Boolean(e.slow),
            })),
            presets,
            lines: db.lines(),
            picks: db.picks(),
          })
        );
      }

      if (path === "/api/catalog") {
        return sendJson(res, 200, {
          engines: options.engines.map((e) => ({
            id: e.id,
            label: e.label,
            voices: e.voices,
            slow: Boolean(e.slow),
          })),
          presets,
          lines: db.lines(),
          picks: db.picks(),
        });
      }

      // --- takes -------------------------------------------------------
      if (path === "/api/takes" && req.method === "POST") {
        const body = await readBody(req);
        const id = db.recordTake(
          String(body.engine ?? ""),
          String(body.voice ?? ""),
          String(body.text ?? ""),
          Number(body.renderMs ?? 0)
        );
        return sendJson(res, 200, { id });
      }

      if (idMatch && idMatch[1] === "api/takes" && req.method === "PATCH") {
        const body = await readBody(req);
        db.setTakeSeconds(Number(idMatch[2]), Number(body.seconds ?? 0));
        return sendJson(res, 200, { ok: true });
      }

      if (idMatch && idMatch[1] === "api/takes" && req.method === "DELETE") {
        db.deleteTake(Number(idMatch[2]));
        return sendJson(res, 200, { ok: true });
      }

      // --- lines -------------------------------------------------------
      if (path === "/api/lines" && req.method === "GET") {
        return sendJson(res, 200, { lines: db.lines() });
      }

      if (path === "/api/lines" && req.method === "POST") {
        const body = await readBody(req);
        const text = String(body.text ?? "").trim();
        if (!text) return sendJson(res, 400, { error: "empty text" });
        db.addLine(text);
        return sendJson(res, 200, { lines: db.lines() });
      }

      if (path === "/api/lines" && req.method === "DELETE") {
        db.clearLines();
        return sendJson(res, 200, { lines: db.lines() });
      }

      if (idMatch && idMatch[1] === "api/lines" && req.method === "DELETE") {
        db.deleteLine(Number(idMatch[2]));
        return sendJson(res, 200, { lines: db.lines() });
      }

      // --- picks -------------------------------------------------------
      if (path === "/api/picks" && req.method === "GET") {
        return sendJson(res, 200, { picks: db.picks() });
      }

      if (path === "/api/picks" && req.method === "POST") {
        const body = await readBody(req);
        const picks = db.togglePick(
          String(body.engine ?? ""),
          String(body.voice ?? ""),
          String(body.text ?? "")
        );
        return sendJson(res, 200, { picks });
      }

      if (path === "/api/picks" && req.method === "DELETE") {
        db.clearPicks();
        return sendJson(res, 200, { picks: db.picks() });
      }

      if (idMatch && idMatch[1] === "api/picks" && req.method === "DELETE") {
        db.deletePick(Number(idMatch[2]));
        return sendJson(res, 200, { picks: db.picks() });
      }

      // --- synthesis ---------------------------------------------------
      if (path === "/api/say") {
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

        // An HTTP engine returns audio bytes directly; a command engine writes
        // a file kino then reads. Both end as a Buffer plus a content type.
        let audio: Buffer;
        let contentType: string;
        if (engine.http) {
          const form = new FormData();
          form.append(engine.http.textField ?? "text", text);
          form.append(engine.http.voiceField ?? "voice", voice);
          for (const [k, v] of Object.entries(engine.http.fields ?? {})) form.append(k, v);

          let upstream: Response;
          try {
            upstream = await fetch(engine.http.url, { method: "POST", body: form });
          } catch (err: unknown) {
            // A refused connection is the common case and deserves a message
            // that says what to do, not "fetch failed".
            const e = err as { cause?: { code?: string }; message?: string };
            const code = e?.cause?.code;
            throw new Error(
              code === "ECONNREFUSED"
                ? `${engine.label} is not running at ${engine.http.url}. ` +
                  `Start it first — see scripts/showcase/start-pocket.cmd.`
                : `${engine.label} request failed: ${e?.message ?? String(err)}`
            );
          }
          if (!upstream.ok) {
            const detail = await upstream.text().catch(() => "");
            // Pocket answers a voice name it does not know by treating it as a
            // path and falling through to voice cloning, which needs gated
            // weights. The raw error says VOICE_CLONING_UNSUPPORTED, which
            // reads like a permissions problem rather than a bad voice name.
            const hint = /VOICE_CLONING_UNSUPPORTED/.test(detail)
              ? ` — the server does not know the voice '${voice}'. Use one from its catalog.`
              : "";
            throw new Error(
              `${engine.label} returned ${upstream.status}${hint}` +
                (detail ? `: ${detail.slice(0, 300)}` : "")
            );
          }
          audio = Buffer.from(await upstream.arrayBuffer());
          const upType = upstream.headers.get("content-type") ?? "";
          contentType = upType.startsWith("audio/")
            ? upType
            : engine.format === "mp3"
              ? "audio/mpeg"
              : "audio/wav";
        } else {
          const wav = await synthesizeToWav(text, {
            ...engine.options,
            voice,
            rate: Number.isFinite(rate) && rate > 0 ? rate : 1,
          });
          audio = readFileSync(wav);
          contentType = engine.format === "mp3" ? "audio/mpeg" : "audio/wav";
        }

        const renderMs = Date.now() - started;
        if (!options.quiet) {
          console.log(
            `[showcase] ${engineId}/${voice} ${renderMs} ms  ${JSON.stringify(text.slice(0, 48))}`
          );
        }
        // The take is recorded here, not by the client: a request that reached
        // synthesis is a take, and the timing is the server's to know.
        const takeId = db.recordTake(engineId, voice, text, renderMs);
        res.setHeader("X-Kino-Take", String(takeId));
        res.setHeader("X-Kino-Render-Ms", String(renderMs));
        res.writeHead(200, {
          "Content-Type": contentType,
          "Content-Length": audio.length,
          "Cache-Control": "no-store",
        });
        return res.end(audio);
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
    dataDir,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => {
          db.close();
          err ? reject(err) : resolve();
        })
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

function sendFile(res: ServerResponse, path: string, type?: string): void {
  if (!existsSync(path) || !statSync(path).isFile()) {
    return sendJson(res, 500, { error: "synthesiser wrote no file" });
  }
  const contentType = type ?? MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": statSync(path).size,
    "Cache-Control": "no-store",
  });
  res.end(readFileSync(path));
}
