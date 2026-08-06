import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { resolve, join, dirname } from "node:path";
import { mkdirSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { render, normalizeComposition, KinoValidationError } from "../src/index.js";
import type { KinoComposition } from "../src/types/index.js";

const app = new Hono();

const currentDir = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(currentDir, "..");
const studioDir = resolve(pkgRoot, "studio");
const rendersDir = join(studioDir, "public", "renders");
const examplesDir = resolve(pkgRoot, "examples");

if (!existsSync(rendersDir)) {
  mkdirSync(rendersDir, { recursive: true });
}

// API Routes
app.get("/api/examples", (c) => {
  try {
    const examples: Record<string, any> = {};
    if (existsSync(examplesDir)) {
      const files = readdirSync(examplesDir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        const name = file.replace(".json", "");
        const content = JSON.parse(readFileSync(join(examplesDir, file), "utf-8"));
        examples[name] = content;
      }
    }
    return c.json({ success: true, examples });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.post("/api/validate", async (c) => {
  try {
    const body = await c.req.json();
    const composition: KinoComposition = body.composition || body;
    normalizeComposition(composition);
    return c.json({ success: true, valid: true, issues: [] });
  } catch (err: any) {
    if (err.name === "KinoValidationError" || (err && Array.isArray(err.issues))) {
      return c.json({
        success: false,
        valid: false,
        error: err.message,
        issues: err.issues,
      });
    }
    return c.json({ success: false, valid: false, error: err.message, issues: [] });
  }
});

app.post("/api/render", async (c) => {
  try {
    const body = await c.req.json();
    const composition: KinoComposition = body.composition || body;
    const encoder = body.encoder;
    const preset = body.preset;
    const unsafeInlineText = body.unsafeInlineText;
    const filename = `render-${Date.now()}.mp4`;
    const outputPath = join(rendersDir, filename);

    if (unsafeInlineText) {
      console.warn(
        "[kino] Warning: unsafeInlineText disables textfile delivery; text with apostrophes may render blank on some platforms."
      );
    }

    console.log(`[Kino Studio] Starting render (${encoder || "auto/default"}, preset=${preset || "default"}): ${filename}`);
    await render(composition, {
      output: outputPath,
      encoder,
      preset,
      unsafeInlineText,
      verbose: true,
    });

    console.log(`[Kino Studio] Render finished: ${filename}`);
    return c.json({
      success: true,
      videoUrl: `/renders/${filename}`,
      filename,
    });
  } catch (err: any) {
    console.error(`[Kino Studio] Render error:`, err.message);
    if (err.name === "KinoValidationError" || (err && Array.isArray(err.issues))) {
      return c.json(
        {
          success: false,
          error: err.message,
          issues: err.issues,
        },
        400
      );
    }
    return c.json({ success: false, error: err.message }, 500);
  }
});

// Serve static assets
app.use("/renders/*", serveStatic({ root: resolve(studioDir, "public") }));
if (existsSync(resolve(studioDir, "dist"))) {
  app.use("/*", serveStatic({ root: resolve(studioDir, "dist") }));
} else {
  app.use("/*", serveStatic({ root: studioDir }));
}

export function startStudio(preferredPort?: number) {
  const initialPort = preferredPort || Number(process.env.PORT) || 3333;
  let currentPort = initialPort;

  while (currentPort < initialPort + 20) {
    try {
      const serverInstance = serve(
        {
          fetch: app.fetch,
          port: currentPort,
        },
        (info) => {
          console.log(`
  🎬 Kino Studio (Hono Server) is running!
  👉 Open in browser: http://localhost:${info.port}
  `);
        }
      );
      return serverInstance;
    } catch (err: any) {
      if (err.code === "EADDRINUSE" && !preferredPort) {
        console.warn(`[Kino Studio] Port ${currentPort} in use, trying ${currentPort + 1}…`);
        currentPort++;
      } else {
        throw err;
      }
    }
  }

  throw new Error(`[Kino Studio] Could not find an open port starting from ${initialPort}`);
}

// Start server if script executed directly
if (process.argv[1]?.includes("server.ts") || process.argv[1]?.includes("server.js")) {
  startStudio();
}
