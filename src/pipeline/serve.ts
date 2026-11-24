import { Hono } from "hono";
import { serve as honoServe } from "@hono/node-server";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { Preview } from "./preview.js";
import { render } from "./render.js";
import { previewPage, renderPage } from "./serve-pages.js";
import { buildAudioLevels } from "./audio-levels.js";
import { getFFmpegBinaryPath } from "../encoder/probe.js";
import { normalizeComposition } from "../normalize/composition.js";
import { resolveTtsTracks, compositionHasTts } from "../tts/resolve.js";
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
  /**
   * RAM budget for the decoded frame cache, in megabytes. Default 512.
   *
   * Frames are decoded once into memory so a seek is an array lookup instead of
   * a process spawn. A clip whose raw frames exceed this keeps the first part
   * resident and seeks the proxy for the rest.
   */
  frameCacheMB?: number;
  /**
   * Timeline second the proxy should cover. Default 0.
   *
   * The proxy is built for a window of the timeline rather than the whole
   * composition, because a full build is a complete render of every frame
   * before the first one appears. Measured on a 164 s chapter at 360p: 61.8 s
   * full against 1.3 s for a 4 s window.
   */
  startAt?: number;
  /**
   * Timeline seconds the proxy should cover. Default `Infinity`, meaning the
   * whole composition.
   *
   * Set this when iterating on one region of a long clip. A seek past the
   * window clamps to its end rather than failing; restart with a different
   * `startAt` to move the window.
   */
  windowSeconds?: number;
  /**
   * Composite frames live instead of building a proxy. **Default false.**
   *
   * Kept as an option because the graph work behind it is sound (see
   * `.memory/findings-live-render.md`), but it is not the recommended path: a
   * heavy composition composites at ~15 fps and the HTTP path was never made
   * reliable. The proxy is what works — build once, then 0.5-5 ms per frame.
   *
   * Enable it only to experiment, and expect it to be slower than the proxy.
   */
  live?: boolean;
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

  /** Scene boundaries, so the timeline can show structure. */
  const sceneMarkers = (() => {
    const out: { id: string; start: number; duration: number }[] = [];
    let t = 0;
    for (const s of composition.scenes as { id?: string; duration?: number }[]) {
      const d = s.duration ?? 0;
      out.push({ id: s.id ?? `scene-${out.length + 1}`, start: t, duration: d });
      t += d;
    }
    return out;
  })();

  /**
   * Audio peaks for the timeline, built once.
   *
   * Audio is buffered differently from video on purpose: a second of it is tens
   * of KB, so the whole clip's envelope fits in a few KB and there is nothing to
   * window or evict. It is computed from the composition's resolved tracks (the
   * proxy itself is video-only), which is also why it has to wait for TTS.
   */
  let audioLevels: Awaited<ReturnType<typeof buildAudioLevels>> | undefined;
  let audioPromise: Promise<void> | undefined;

  function ensureAudio(): Promise<void> {
    if (audioLevels) return Promise.resolve();
    if (audioPromise) return audioPromise;
    audioPromise = (async () => {
      try {
        const resolved = compositionHasTts(composition)
          ? await resolveTtsTracks(composition)
          : composition;
        const norm = normalizeComposition(resolved);
        audioLevels = await buildAudioLevels(
          getFFmpegBinaryPath(options.ffmpegPath),
          norm.audio as { src: string; startTime?: number; duration?: number; volume?: number }[],
          norm.duration
        );
      } catch (err) {
        // A waveform is a nicety; a failure must not break the preview.
        console.warn(`[kino] audio levels unavailable: ${(err as Error).message}`);
      }
    })();
    return audioPromise;
  }

  /** Builds the seek proxy. Slow once; flat cost per frame afterwards. */
  app.post("/api/proxy", async (c) => {
    const started = Date.now();
    try {
      if (!session) {
        session = await enqueue(() =>
          Preview.open(composition, {
            height,
            format: "jpg",
            frameCacheMB: options.frameCacheMB,
            live: options.live,
            startAt: options.startAt,
            windowSeconds: options.windowSeconds,
          })
        );
      }
      // Decode the proxy into RAM now, so the first scrub is not the first
      // decode. In live mode there is no proxy or cache, so this is a no-op.
      const warmStart = Date.now();
      await session.warmCache();
      const cacheMs = Date.now() - warmStart;

      // Captured once: the object below is built inside `c.json()`, where TS
      // cannot carry the narrowing from the `if (!session)` above.
      const s = session;
      return c.json({
        success: true,
        ms: Date.now() - started,
        cacheMs,
        live: s.isLive,
        // What this proxy covers, not the composition's full length: the page
        // lays its scrub bar out from these, and a windowed proxy holds only
        // its window's frames.
        duration: s.window,
        offset: s.offset,
        totalDuration: s.length,
        fps: s.frameRate,
        size: s.size,
        cache: await s.getCacheStats(),
        // Only the scenes this proxy can show, in proxy-local time. Sending the
        // whole timeline's markers made the page lay out 56 bars over a 4 s
        // window, 42 of them past its end.
        //
        // Shifted into proxy time, kept if they overlap it, and clamped to its
        // ends: the scene straddling the window's edge is genuinely cut there,
        // so its bar must stop at the edge too.
        scenes: sceneMarkers
          .map((m) => ({ ...m, start: m.start - s.offset, end: m.start + m.duration - s.offset }))
          .filter((m) => m.end > 0 && m.start < s.window)
          .map((m) => {
            const start = Math.max(0, m.start);
            const end = Math.min(s.window, m.end);
            return { id: m.id, start, duration: end - start };
          }),
      });
    } catch (err: unknown) {
      const e = err as { message?: string };
      return c.json({ success: false, error: e?.message ?? String(err) }, 500);
    }
  });

  /**
   * One frame.
   *
   * `?raw=1` returns rgb24 bytes with the dimensions in headers — the browser
   * paints them with `putImageData`, which is a memcpy. That path is ~0.2 ms.
   * Without `raw` the frame is JPEG, which needs a process spawn (~640 ms on
   * Windows), so it exists for `<img>` and vision models, not for scrubbing.
   */
  app.get("/api/frame", async (c) => {
    if (!session) return c.json({ success: false, error: "no proxy yet" }, 409);
    // `t` is in the proxy's own clock (0 .. duration), which is what the page
    // lays its scrub bar out in. `rawFrameAt` wants timeline-absolute seconds,
    // so a windowed proxy has its offset added here rather than in the page.
    const t = Number(c.req.query("t") ?? "0") + session.offset;
    if (!Number.isFinite(t)) return c.json({ success: false, error: "bad t" }, 400);

    if (c.req.query("raw")) {
      // Cache hit is an array lookup; a miss seeks the proxy. Neither path
      // errors for a valid timestamp, so dragging past the end of the cache
      // feels slower instead of breaking.
      try {
        const frame = await session.rawFrameAt(t);
        return new Response(new Uint8Array(frame.data), {
          headers: {
            "Content-Type": "application/octet-stream",
            "Cache-Control": "no-store",
            "X-Frame-Width": String(frame.width),
            "X-Frame-Height": String(frame.height),
          },
        });
      } catch (err: unknown) {
        const e = err as { message?: string };
        return c.json({ success: false, error: e?.message ?? String(err) }, 500);
      }
    }

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

  /**
   * Pages are served `no-store`.
   *
   * A preview page is generated from the running code, so a cached copy is
   * always wrong after a restart — and a stale page silently keeps the old
   * behaviour while the server has moved on. There is nothing worth caching
   * here: the page is a few KB and regenerated instantly.
   */
  const html = (body: string) =>
    new Response(body, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, must-revalidate",
      },
    });

  /** The preview player. Builds a proxy, then plays and scrubs it. */
  app.get("/", (c) => html(previewPage(options.reload !== false)));

  /** The render screen. Produces the final mp4. Separate from the preview. */
  app.get("/render", (c) => html(renderPage(options.reload !== false)));
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
