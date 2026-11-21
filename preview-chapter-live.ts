// DEPRECATED — kept only to reproduce the live experiment.
//
// Live mode never served frames reliably over HTTP; see
// .memory/findings-live-render.md. Use preview-chapter.ts instead: it builds a
// 144p/360p proxy and serves frames at 0.5-5 ms each.
import { pathToFileURL } from "node:url";

const CLIP = "D:/Projects/Misc/paper-ghost/clips/kaguya-hates-cats";
process.chdir(CLIP);

const { serve } = await import(pathToFileURL("D:/Projects/Misc/kino/dist/index.js").href);

const mod = await import(pathToFileURL(`${CLIP}/chapter.mts`).href);
const raw = mod.default ?? mod;
const comp = typeof raw === "function" ? await raw() : raw;

const total = comp.scenes.reduce((a, s) => a + Number(s.duration ?? 0), 0);
console.log(`[kino] chapter: ${comp.scenes.length} scenes, ${total.toFixed(2)}s — LIVE, no proxy`);

await serve(comp, {
  port: 8000,
  height: 144,
  live: true,
  dir: "D:/Projects/Misc/kino/.kino-chapter-live",
});
