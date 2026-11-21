// Build a video-only arg set from the compiled args so rawvideo works.
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { pathToFileURL } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLIP = "D:/Projects/Misc/paper-ghost/clips/kaguya-hates-cats";
process.chdir(CLIP);

const mod = await import(pathToFileURL(`${CLIP}/chapter.mts`).href);
const raw = mod.default ?? mod;
const comp = typeof raw === "function" ? await raw() : raw;

const { compile } = await import(pathToFileURL("D:/Projects/Misc/kino/src/pipeline/compile.ts").href);
const { extractKino, readKinoManifest } = await import(pathToFileURL("D:/Projects/Misc/kino/src/artifact/kino.ts").href);
const { renderTakumiElements } = await import(pathToFileURL("D:/Projects/Misc/kino/src/pipeline/elements/takumi-elements.ts").href);
const { resolveTtsTracks, compositionHasTts } = await import(pathToFileURL("D:/Projects/Misc/kino/src/tts/resolve.ts").href);

const takumiRenders = await renderTakumiElements(comp);
const resolved = compositionHasTts(comp) ? await resolveTtsTracks(comp) : comp;

const dir = mkdtempSync(join(tmpdir(), "kino-vo-"));
const k = compile(resolved, { output: join(dir, "o.mp4"), takumiRenders, preview: 144 });
const extractDir = join(dir, "x");
extractKino(k.kinoFilePath, extractDir);
const m = readKinoManifest(k.kinoFilePath);
const all = m.ffmpegArgs.slice(0, -1);

// Find the first "-map" — everything before it is inputs + filtergraph script.
const mapAt = all.indexOf("-map");
console.log("total args:", all.length, " first -map at:", mapAt);
console.log("around -map:", all.slice(mapAt, mapAt + 8).join(" "));

// Video pad name is the first -map value.
const videoPad = all[mapAt + 1];
console.log("video pad:", videoPad);

const videoOnly = [
  ...all.slice(0, mapAt),
  "-map", videoPad,
  // The graph's audio chain still exists, and ffmpeg rejects a filtergraph with
  // an unconnected output ("Filter amix:default has an unconnected output").
  // Sending it to a null sink keeps the graph valid while only the video reaches
  // stdout.
  "-map", all[mapAt + 3],
  "-f", "null", "-",
];

console.log("video-only arg count:", videoOnly.length);

const W = 256, H = 144, STRIDE = W * H * 4;

function run(count) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const c = spawn(ffmpegPath, [
      "-hide_banner", "-loglevel", "error",
      ...videoOnly,
      "-frames:v", String(count),
      "-f", "rawvideo", "-pix_fmt", "rgba", "-",
    ], { cwd: extractDir, stdio: ["ignore", "pipe", "pipe"] });

    let bytes = 0, first = -1, err = "";
    c.stdout.on("data", (d) => {
      bytes += d.length;
      if (first < 0 && bytes >= STRIDE) first = Date.now() - t0;
    });
    c.stderr.on("data", (d) => (err += d));
    c.on("close", (code) => {
      const frames = Math.floor(bytes / STRIDE);
      resolve({ ms: Date.now() - t0, frames, first, code, err: err.slice(-200) });
    });
  });
}

for (const n of [1, 30, 120]) {
  const r = await run(n);
  console.log(`  frames=${String(n).padStart(3)}  total ${String(r.ms).padStart(6)} ms  first ${String(r.first).padStart(5)} ms  got=${r.frames}  exit=${r.code}`);
  if (r.frames === 0) console.log("    err:", r.err);
}

rmSync(dir, { recursive: true, force: true });
