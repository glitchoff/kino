import { Hono } from "hono";
import { serve as honoServe } from "@hono/node-server";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { Preview } from "./preview.js";
import { render } from "./render.js";
import { previewPage, renderPage } from "./serve-pages.js";
import type { KinoComposition } from "../types/index.js";
import type { RenderOptions } from "../types/render.js";

/**
 * A live preview server for a composition.
 *
 * Two things a browser needs from an editor, and they are different:
 *
 * - **Seek.** Scrub the timeline and see the frame under the cursor. This works
 *   by rendering the composition once to a small all-keyframe proxy, then
 *   seeking it â€” ~23 ms per frame, flat, regardless of timestamp. The first
 *   build is a full render at proxy size; after that scrubbing is instant.
 * - **Play.** A real mp4 with audio, joined from cached segments, so a re-render
 *   after an edit only re-encodes what changed.
 *
 * ## HMR
 *
 * Pass `reload: true` and the page reloads itself when the server restarts.
 * Under `tsx watch` (or any watcher that restarts the process) that means a
 * source change reaches the browser without a manual refresh: the page polls a
 * boot id, and a new id triggers `location.reload()`.
 *
 * The composition itself is not re-read here â€” the caller owns that. A watcher
 * restarting the process is what picks up a code change.
 *
 * ```ts
 * import { serve } from "@glitchoff/kino";
 * import { composition } from "@glitchoff/kino";
 *
 * const video = composition({ width: 1080, height: 1920 })
 *   .scene({ duration: 5 }, (s) => s.text("Hello", { x: "center", y: "center" }))
 *   .build();
 *
 * await serve(video, { port: 3333 });
 * // then: npx tsx watch my-composition.ts
 * ```
 */
/**
 * Options for {@link serve}.
 *
 * A preview server chooses its own output path and cache directory, so the
 * render options that describe *where* a render goes are omitted. Everything
 * that affects the picture (encoder, crf, preset) is passed through.
 */
export interface ServeOptions extends Omit<RenderOptions, "output" | "cache" | "cacheDir"> {
  /** Port to listen on. Default 3333; the next 20 are tried if it is taken. */
  port?: number;
  /** Height of the seek proxy, in pixels. Default 360. */
  height?: number;
  /** Reload the page when the server restarts. Default true. */
  reload?: boolean;
  /** Directory for the proxy and segment cache. Default `.kino-serve` beside cwd. */
  dir?: string;
}

export interface ServeHandle {
  /** The port actually bound. */
  port: number;
  /** URL to open. */
  url: string;
  /** Stops the server and frees the proxy. */
  close: () => Promise<void>;
}

/**
 * Serves a composition for live preview. Resolves once listening.
 *
 * The returned handle keeps the server running; `close()` stops it. Under a
 * watcher the process is restarted, which is the intended way to pick up edits.
 */
export async function serve(
  composition: KinoComposition,
  options: ServeOptions = {}
): Promise<ServeHandle> {
  const height = options.height ?? 360;
  const dir = options.dir ?? ".kino-serve";
  const cacheDir = `${dir}/cache`;
  const playPath = `${dir}/preview.mp4`;

  const app = new Hono();

  /** Regenerated per process, so the page can tell the code moved on. */
  const bootId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  app.get("/api/boot", (c) => c.json({ bootId }));

  let session: Preview | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  /** Serialises renders: two would fight over the same cache directory. */
  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = queue.then(job, job);
    queue = next.catch(() => undefined);
    return next;
  }

  /** Builds the seek proxy. Slow once; flat cost per frame afterwards. */
  app.post("/api/proxy", async (c) => {
    const started = Date.now();
    try {
      if (!session) {
        session = await enqueue(() => Preview.open(composition, { height, format: "jpg" }));
      }
      return c.json({
        success: true,
        ms: Date.now() - started,
        duration: session.length,
        fps: session.frameRate,
      });
    } catch (err: unknown) {
      const e = err as { message?: string };
      return c.json({ success: false, error: e?.message ?? String(err) }, 500);
    }
  });

  /** One frame, by seeking the proxy. */
  app.get("/api/frame", async (c) => {
    if (!session) return c.json({ success: false, error: "no proxy yet" }, 409);
    const t = Number(c.req.query("t") ?? "0");
    if (!Number.isFinite(t)) return c.json({ success: false, error: "bad t" }, 400);

    try {
      const frame = await session.frame(t);
      return new Response(new Uint8Array(frame.data), {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "no-store",
          "X-Frame-Ms": String(frame.ms),
        },
      });
    } catch (err: unknown) {
      const e = err as { message?: string };
      return c.json({ success: false, error: e?.message ?? String(err) }, 500);
    }
  });

  /**
   * The proxy as a playable video.
   *
   * Every frame in it is a keyframe, so a `<video>` plays it smoothly and seeks
   * instantly. This is the same artifact the frame endpoint reads, which means
   * playback and scrubbing can never disagree about what the clip looks like.
   */
  app.get("/api/proxy.mp4", (c) => {
    if (!session) return c.json({ success: false, error: "no proxy yet" }, 409);
    return rangeServe(session.proxyFile, c.req.header("range"), "video/mp4");
  });

  /**
   * Renders the final mp4, reusing cached segments.
   *
   * Separate from the preview on purpose: this is the deliverable, at full
   * quality and size, not a proxy. It is slower and it writes a different file,
   * so it lives behind its own path rather than sharing the player.
   */
  app.post("/api/render", async (c) => {
    const started = Date.now();
    try {
      // Only render options reach `render()`; the serve-only keys are dropped so
      // a stray `port` never lands in a render.
      const { port, height: _h, reload, dir: _d, ...renderOptions } = options;
      const result = await enqueue(() =>
        render(composition, {
          ...renderOptions,
          output: playPath,
          cache: true,
          cacheDir,
          preview: height,
        })
      );
      return c.json({
        success: true,
        url: `/api/video?v=${Date.now()}`,
        ms: Date.now() - started,
        reused: result.reused ?? 0,
        rendered: result.rendered ?? 0,
      });
    } catch (err: unknown) {
      const e = err as { message?: string };
      return c.json({ success: false, error: e?.message ?? String(err) }, 500);
    }
  });

  /** The rendered mp4, with range support so `<video>` can seek. */
  app.get("/api/video", (c) => {
    if (!existsSync(playPath)) return c.json({ success: false, error: "not rendered yet" }, 404);
    return rangeServe(playPath, c.req.header("range"), "video/mp4");
  });

  /** The preview player. Builds a proxy, then plays and scrubs it. */
  app.get("/", (c) => c.html(previewPage(options.reload !== false)));

  /** The render screen. Produces the final mp4. Separate from the preview. */
  app.get("/render", (c) => c.html(renderPage(options.reload !== false)));
  const port = await freePort(options.port ?? 3333);
  const server = await new Promise<ReturnType<typeof honoServe>>((resolve, reject) => {
    const s = honoServe({ fetch: app.fetch, port }, () => resolve(s));
    s.on("error", reject);
  });

  console.log(`[kino] preview at http://localhost:${port}`);

  return {
    port,
    url: `http://localhost:${port}`,
    close: async () => {
      session?.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * Serves a file with HTTP range support.
 *
 * `<video>` seeks with Range requests. Without them the browser has to download
 * the whole file before it can scrub or start playing from a non-zero point.
 */
function rangeServe(file: string, range: string | undefined, type: string): Response {
  const { size } = statSync(file);

  if (!range) {
    return new Response(createReadStream(file) as unknown as ReadableStream, {
      headers: {
        "Content-Type": type,
        "Content-Length": String(size),
        "Accept-Ranges": "bytes",
      },
    });
  }

  const m = /bytes=(\d*)-(\d*)/.exec(range);
  const start = m?.[1] ? Number(m[1]) : 0;
  const end = m?.[2] ? Number(m[2]) : size - 1;

  if (start >= size || end >= size || start > end) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}` },
    });
  }

  return new Response(createReadStream(file, { start, end }) as unknown as ReadableStream, {
    status: 206,
    headers: {
      "Content-Type": type,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes",
    },
  });
}

/** First free port at or above `from`, probing 20 ahead. */
async function freePort(from: number): Promise<number> {
  for (let p = from; p < from + 20; p++) {
    if (await isFree(p)) return p;
  }
  throw new Error(`[kino] no free port from ${from}`);
}

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "::");
  });
}
