import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { resolve, join } from "node:path";
import { mkdirSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { render } from "../src/index.js";
import type { KinoComposition } from "../src/types.js";

const app = new Hono();

const studioDir = resolve(process.cwd(), "studio");
const rendersDir = join(studioDir, "public", "renders");
const examplesDir = resolve(process.cwd(), "examples");

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
    return c.json({ success: false, error: err.message }, 500);
  }
});

// Serve static assets
app.use("/renders/*", serveStatic({ root: "./studio/public" }));
app.use("/*", serveStatic({ root: "./studio" }));

export function startStudio(port?: number) {
  const PORT = port || Number(process.env.PORT) || 3333;
  return serve(
    {
      fetch: app.fetch,
      port: PORT,
    },
    (info) => {
      console.log(`
  🎬 Kino Studio (Hono Server) is running!
  👉 Open in browser: http://localhost:${info.port}
  `);
    }
  );
}

// Start server if script executed directly
if (process.argv[1]?.includes("server.ts") || process.argv[1]?.includes("server.js")) {
  startStudio();
}
