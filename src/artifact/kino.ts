import AdmZip from "adm-zip";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

export interface KinoManifest {
  ffmpegArgs: string[];
  output: string;
  kinoVersion: string;
}

export function packKino(stagingDir: string, kinoPath: string): void {
  mkdirSync(dirname(kinoPath), { recursive: true });
  const zip = new AdmZip();
  for (const file of readdirSync(stagingDir, { withFileTypes: true })) {
    if (file.isFile()) {
      zip.addFile(file.name, readFileSync(`${stagingDir}/${file.name}`));
    }
  }
  zip.writeZip(kinoPath);
}

export function extractKino(kinoPath: string, destDir: string): void {
  const zip = new AdmZip(kinoPath);
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const target = resolve(destDir, entry.entryName);
    if (target !== destDir && !target.startsWith(destDir + sep)) {
      throw new Error(`Refusing to extract unsafe .kino entry: ${entry.entryName}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, entry.getData());
  }
}

export function readKinoManifest(kinoPath: string): KinoManifest {
  const zip = new AdmZip(kinoPath);
  const entry = zip.getEntry("manifest.json");
  if (!entry) {
    throw new Error(`Invalid .kino file (missing manifest.json): ${kinoPath}`);
  }
  return JSON.parse(entry.getData().toString("utf8")) as KinoManifest;
}
