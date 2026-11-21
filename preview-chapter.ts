// Preview the full Paper Ghost chapter from its composition source.
//
// Reads paper-ghost, writes nothing into it. cwd is the clip folder so the
// composition's relative panel paths resolve; the proxy and frame cache live in
// kino's own directory.
import { pathToFileURL } from "node:url";

const CLIP = "D:/Projects/Misc/paper-ghost/clips/kaguya-hates-cats";
process.chdir(CLIP);

const { serve } = await import(pathToFileURL("D:/Projects/Misc/kino/dist/index.js").href);

const mod = await import(pathToFileURL(`${CLIP}/chapter.mts`).href);
const raw = mod.default ?? mod;
const comp = typeof raw === "function" ? await raw() : raw;

const total = comp.scenes.reduce((a, s) => a + Number(s.duration ?? 0), 0);
console.log(`[kino] chapter: ${comp.scenes.length} scenes, ${total.toFixed(2)}s`);

await serve(comp, {
  port: 8000,
  // 177s at 640x360 rgba would be 4.7 GB held whole; a 512 MB window slides
  // instead, so any region is fast once visited and RAM stays flat.
  height: 360,
  frameCacheMB: 512,
  dir: "D:/Projects/Misc/kino/.kino-chapter-preview",
});
