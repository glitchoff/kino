import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { resolve, join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { compile, render } from "../src/index.js";
import type { KinoComposition } from "../src/types.js";

const app = new Hono();

const studioDir = resolve(process.cwd(), "studio");
const rendersDir = join(studioDir, "public", "renders");

if (!existsSync(rendersDir)) {
  mkdirSync(rendersDir, { recursive: true });
}

// API Routes
app.post("/api/compile", async (c) => {
  try {
    const composition: KinoComposition = await c.req.json();
    const result = compile(composition, { output: "./out.mp4" });
    return c.json({
      success: true,
      args: result.args,
      filtergraph: result.filtergraph,
      command: `ffmpeg ${result.args.join(" ")}`,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

app.post("/api/render", async (c) => {
  try {
    const composition: KinoComposition = await c.req.json();
    const filename = `render-${Date.now()}.mp4`;
    const outputPath = join(rendersDir, filename);

    const { args } = compile(composition, { output: outputPath });

    console.log(`[Kino Studio] Starting render: ${filename}`);
    await render(composition, {
      output: outputPath,
      verbose: true,
    });

    console.log(`[Kino Studio] Render finished: ${filename}`);
    return c.json({
      success: true,
      videoUrl: `/renders/${filename}`,
      filename,
      command: `ffmpeg ${args.join(" ")}`,
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
