// Preview the approved Paper Ghost opening, against the BUILT package.
//
// Reads paper-ghost, writes nothing into it. The proxy and frame cache live in
// kino's own directory; cwd is only set to the clip folder so the composition's
// relative panel paths resolve.
import { pathToFileURL } from "node:url";

const CLIP = "D:/Projects/Misc/paper-ghost/clips/kaguya-hates-cats";
process.chdir(CLIP);

const { serve } = await import(pathToFileURL("D:/Projects/Misc/kino/dist/index.js").href);

const mod = await import(
  pathToFileURL(`${CLIP}/approved/source/opening2.mts`).href
);
const raw = mod.default ?? mod;
const comp = typeof raw === "function" ? await raw() : raw;

console.log("[kino] composition loaded:", comp.scenes?.length, "scenes");

await serve(comp, {
  port: 3340,
  height: 360,
  // A whole 21.5s clip at 640x360 is 646 frames * 921600 B = 595 MB, so 640 MB
  // caches all of it and there is no tail to fall back on.
  frameCacheMB: 640,
  dir: "D:/Projects/Misc/kino/.kino-ghost-preview",
});
