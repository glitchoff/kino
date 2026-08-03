import { spawnSync } from "node:child_process";
import type { NormalizedComposition } from "./types.js";

export const KINO_VERSION = "0.11.1";

export const REMOTE_DOWNLOADER_SCRIPT = [
  'const fs=require("fs");',
  'const path=require("path");',
  'const outDir=process.argv[1];',
  'const urls=JSON.parse(process.argv[2]);',
  `const UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Kino/${KINO_VERSION}";`,
  'const EXT={"image/jpeg":".jpg","image/jpg":".jpg","image/png":".png","image/gif":".gif","image/webp":".webp","audio/mpeg":".mp3","audio/mp3":".mp3","audio/wav":".wav","audio/x-wav":".wav","audio/aac":".aac","audio/ogg":".ogg","audio/mp4":".m4a","video/mp4":".mp4","video/quicktime":".mov","video/webm":".webm"};',
  "(async()=>{",
  "  const results={};",
  "  await Promise.all(urls.map(async(u,i)=>{",
  "    try{",
  '      const res=await fetch(u,{headers:{"User-Agent":UA},redirect:"follow"});',
  '      if(!res.ok)throw new Error("HTTP "+res.status);',
  "      const buf=Buffer.from(await res.arrayBuffer());",
  '      const ct=(res.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();',
  '      const ext=EXT[ct]||".bin";',
  '      const name="remote-"+(i+1)+ext;',
  "      fs.writeFileSync(path.join(outDir,name),buf);",
  "      results[u]={ext:ext};",
  "    }catch(e){results[u]={error:String((e&&e.message)||e)};}",
  "  }));",
  "  process.stdout.write(JSON.stringify(results));",
  "  process.exit(0);",
  "})();",
].join("\n");

export function prestageRemoteAssets(
  stagingDir: string,
  norm: NormalizedComposition
): Map<string, string> {
  const isRemote = (src: string): boolean =>
    src.startsWith("http://") || src.startsWith("https://");
  const urls = new Set<string>();
  for (const scene of norm.scenes) {
    if (scene.background.type === "image" || scene.background.type === "video") {
      if (isRemote(scene.background.src)) urls.add(scene.background.src);
    }
  }
  for (const elem of norm.elements) {
    if (elem.type === "image") {
      if (isRemote(elem.src)) urls.add(elem.src);
    } else if (elem.type === "video") {
      if (isRemote(elem.src)) urls.add(elem.src);
    } else if (elem.type === "text" && elem.fontFile) {
      if (isRemote(elem.fontFile)) urls.add(elem.fontFile);
    }
  }
  for (const track of norm.audio) {
    if (isRemote(track.src)) urls.add(track.src);
  }

  const unique = [...urls];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;

  const res = spawnSync(
    process.execPath,
    ["-e", REMOTE_DOWNLOADER_SCRIPT, stagingDir, JSON.stringify(unique)],
    { encoding: "utf-8", timeout: 300000, maxBuffer: 16 * 1024 * 1024 }
  );

  if (res.error) {
    throw new Error(`Failed to download remote assets: ${res.error.message}`);
  }
  if (res.status !== 0) {
    throw new Error(
      `Failed to download remote assets: ${(res.stderr || "").trim() || `exit code ${res.status}`}`
    );
  }

  let results: Record<string, { ext?: string; error?: string }>;
  try {
    results = JSON.parse(res.stdout);
  } catch {
    throw new Error("Failed to download remote assets: unexpected downloader output");
  }

  unique.forEach((url, i) => {
    const r = results[url];
    if (!r || r.error) {
      throw new Error(`Failed to download remote asset '${url}': ${r?.error || "unknown error"}`);
    }
    map.set(url, `remote-${i + 1}${r.ext || ".bin"}`);
  });

  return map;
}
