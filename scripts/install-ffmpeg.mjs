#!/usr/bin/env node
// Downloads a static Linux FFmpeg binary that includes drawtext support
// (built with libharfbuzz + libfreetype). On Windows and macOS this is a
// no-op: ffmpeg-static already ships a working binary there.
//
// Why Linux only: ffmpeg-static's Linux build predates the FFmpeg 6.1
// requirement that drawtext needs both --enable-libfreetype AND
// --enable-libharfbuzz, so text elements silently fail on Linux. We ship our
// own pinned BtbN build instead, and verify drawtext is actually present in
// the extracted binary before reporting success.
//
// Extraction is pure-JS (xz-decompress + tar) so it works on minimal Linux
// images (e.g. debian-slim) that lack an `xz` binary or even `tar`.
//
// Source: BtbN/FFmpeg-Builds, pinned to an immutable dated release.
// License: GPLv3 (see https://github.com/BtbN/FFmpeg-Builds).
//
// Modes:
//   (no args)     user-facing setup; prints progress + result to stdout
//   --print-path  prints ONLY the resolved ffmpeg binary path to stdout
//                 (no other output) so scripts can capture it programmatically

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { get } from "node:https";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import xzDecompress from "xz-decompress";
import * as tar from "tar";
import ffmpegStatic from "ffmpeg-static";

const { XzReadableStream } = xzDecompress;

const RELEASE_TAG = "autobuild-2026-08-01-13-21";
const ASSETS = {
  x64: "ffmpeg-n7.1.5-12-g1fdbca85aa-linux64-gpl-7.1.tar.xz",
  arm64: "ffmpeg-n7.1.5-12-g1fdbca85aa-linuxarm64-gpl-7.1.tar.xz",
};
const BASE_URL = `https://github.com/BtbN/FFmpeg-Builds/releases/download/${RELEASE_TAG}`;
const DOWNLOAD_TIMEOUT = 15 * 60 * 1000;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const printPath = process.argv.includes("--print-path");

function log(message) {
  if (!printPath) console.log(message);
}

function fail(message) {
  throw new Error(message);
}

function download(url, dest, onProgress) {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const settle = (fn) => (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const onResolve = settle(resolvePromise);
    const onReject = settle(rejectPromise);

    const req = get(url, { headers: { "user-agent": "kino-install" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (url === res.headers.location) {
          onReject(new Error("redirect loop"));
          return;
        }
        download(res.headers.location, dest, onProgress).then(onResolve, onReject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        onReject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const total = Number(res.headers["content-length"]) || 0;
      let received = 0;
      res.on("data", (chunk) => {
        received += chunk.length;
        if (onProgress) onProgress(received, total);
      });
      const file = createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => file.close(onResolve));
      file.on("error", onReject);
    });

    const timer = setTimeout(
      () => onReject(new Error(`download timed out after ${DOWNLOAD_TIMEOUT / 60000} minutes`)),
      DOWNLOAD_TIMEOUT
    );
    req.on("error", onReject);
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

function verifyDrawtext(binary) {
  try {
    const output = execFileSync(binary, ["-filters"], {
      encoding: "utf8",
      timeout: 30000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.includes("drawtext");
  } catch {
    return false;
  }
}

function progressLogger() {
  let lastPct = -1;
  return (received, total) => {
    if (!total) return;
    const pct = Math.floor((received / total) * 100);
    if (pct >= lastPct + 5) {
      lastPct = pct;
      log(`[kino]   ${pct}% (${(received / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB)`);
    }
  };
}

async function installLinux() {
  const asset = ASSETS[process.arch];
  if (!asset) {
    console.warn(`[kino] No bundled ffmpeg available for linux/${process.arch}, falling back to ffmpeg-static.`);
    if (printPath && typeof ffmpegStatic === "string") {
      process.stdout.write(ffmpegStatic);
    }
    return;
  }

  const vendorDir = resolve(scriptDir, "..", "vendor", "linux", process.arch);
  const outBin = join(vendorDir, "ffmpeg");
  if (existsSync(outBin)) {
    log(`[kino] ffmpeg already present at ${outBin}`);
    if (printPath) process.stdout.write(outBin);
    return;
  }

  const tarball = join(tmpdir(), asset);
  mkdirSync(vendorDir, { recursive: true });
  const extractDir = mkdtempSync(join(tmpdir(), "kino-ffmpeg-"));
  try {
    log(`[kino] Downloading bundled Linux ffmpeg (${asset})...`);
    await download(`${BASE_URL}/${asset}`, tarball, progressLogger());

    log("[kino] Extracting ffmpeg...");
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
    }
    rmSync(outBin, { force: true });
    copyFileSync(binary, outBin);
    rmSync(binary, { force: true });
    chmodSync(outBin, 0o755);

    if (!verifyDrawtext(outBin)) {
      rmSync(outBin, { force: true });
      fail("extracted binary has no drawtext support (missing libharfbuzz/freetype)");
    }

    log(`[kino] Installed ffmpeg to ${outBin} (drawtext verified)`);
    if (printPath) process.stdout.write(outBin);
  } finally {
    rmSync(extractDir, { recursive: true, force: true });
    rmSync(tarball, { force: true });
  }
}

async function main() {
  if (process.platform !== "linux") {
    const binary = typeof ffmpegStatic === "string" ? ffmpegStatic : "ffmpeg";
    if (printPath) {
      process.stdout.write(binary);
      return;
    }
    log(`[kino] ffmpeg: using ffmpeg-static on ${process.platform} (${binary})`);
    return;
  }
  await installLinux();
}

main().catch((error) => {
  console.error(`[kino] Failed to install bundled Linux ffmpeg: ${error.message}`);
  console.error("[kino] This binary is required for text rendering (drawtext) on Linux.");
  console.error("[kino] Download it manually and pass it via --ffmpeg-path / FFMPEG_PATH, then retry the install.");
  process.exit(1);
});
