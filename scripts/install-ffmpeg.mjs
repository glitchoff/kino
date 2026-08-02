#!/usr/bin/env node
// Downloads a static Linux FFmpeg binary that includes drawtext support
// (built with libharfbuzz + libfreetype). No-op on non-Linux platforms.
//
// Why: ffmpeg-static's Linux build predates the FFmpeg 6.1 requirement that
// drawtext needs both --enable-libfreetype AND --enable-libharfbuzz, so text
// elements silently fail on Linux. We ship our own pinned BtbN build instead.
//
// Extraction is pure-JS (xz-decompress + tar) so it works on minimal Linux
// images (e.g. debian-slim) that lack an `xz` binary or even `tar`.
//
// Source: BtbN/FFmpeg-Builds, pinned to an immutable dated release.
// License: GPLv3 (see https://github.com/BtbN/FFmpeg-Builds).

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { get } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import xzDecompress from "xz-decompress";
import * as tar from "tar";

const { XzReadableStream } = xzDecompress;

const RELEASE_TAG = "autobuild-2026-08-01-13-21";
const ASSETS = {
  x64: "ffmpeg-n7.1.5-12-g1fdbca85aa-linux64-gpl-7.1.tar.xz",
  arm64: "ffmpeg-n7.1.5-12-g1fdbca85aa-linuxarm64-gpl-7.1.tar.xz",
};
const BASE_URL = `https://github.com/BtbN/FFmpeg-Builds/releases/download/${RELEASE_TAG}`;

if (process.platform !== "linux") {
  process.exit(0);
}

const asset = ASSETS[process.arch];
if (!asset) {
  console.warn(`[kino] No bundled ffmpeg available for linux/${process.arch}, falling back to ffmpeg-static.`);
  process.exit(0);
}

const vendorDir = resolve(process.cwd(), "vendor", "linux", process.arch);
const outBin = join(vendorDir, "ffmpeg");
if (existsSync(outBin)) {
  console.log(`[kino] ffmpeg already present at ${outBin}`);
  process.exit(0);
}

const tarball = join(tmpdir(), asset);

function fail(message) {
  console.error(`[kino] Failed to install bundled Linux ffmpeg: ${message}`);
  console.error("[kino] This binary is required for text rendering (drawtext) on Linux.");
  console.error("[kino] Download it manually and pass it via --ffmpeg-path / FFMPEG_PATH, then retry the install.");
  process.exit(1);
}

function download(url, dest) {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = get(url, { headers: { "user-agent": "kino-install" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (url === res.headers.location) {
          rejectPromise(new Error("redirect loop"));
          return;
        }
        download(res.headers.location, dest).then(resolvePromise, rejectPromise);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        rejectPromise(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const file = createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => file.close(resolvePromise));
      file.on("error", rejectPromise);
    });
    req.on("error", rejectPromise);
  });
}

function findFfmpeg(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      const found = findFfmpeg(path);
      if (found) return found;
    } else if (entry === "ffmpeg") {
      return path;
    }
  }
  return null;
}

async function main() {
  mkdirSync(vendorDir, { recursive: true });
  const extractDir = mkdtempSync(join(tmpdir(), "kino-ffmpeg-"));
  try {
    console.log(`[kino] Downloading bundled Linux ffmpeg (${asset})...`);
    await download(`${BASE_URL}/${asset}`, tarball);

    console.log("[kino] Extracting ffmpeg...");
    const compressed = Readable.toWeb(createReadStream(tarball));
    const decompressed = new XzReadableStream(compressed);
    await pipeline(
      Readable.fromWeb(decompressed),
      tar.x({
        cwd: extractDir,
        filter: (path) => /\/bin\/ffmpeg$/.test(path),
      })
    );

    const binary = findFfmpeg(extractDir);
    if (!binary) {
      fail("no ffmpeg binary found inside the archive");
      return;
    }
    rmSync(outBin, { force: true });
    renameSync(binary, outBin);
    chmodSync(outBin, 0o755);
    console.log(`[kino] Installed ffmpeg to ${outBin}`);
  } catch (err) {
    fail(err.message);
  } finally {
    rmSync(extractDir, { recursive: true, force: true });
    rmSync(tarball, { force: true });
  }
}

main();
