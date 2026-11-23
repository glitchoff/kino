#!/usr/bin/env node
// Downloads the `gpucap` text renderer for this platform from the kino GitHub
// release that matches this package version, and unpacks it to
// bin/<platform>-<arch>/gpucap[.exe].
//
// Why a download and not a bundled binary: `gpucap` is Rust, so it has to be
// compiled per platform. Shipping three ~10 MB binaries inside the npm tarball
// would triple the package for a feature most users never turn on. Instead each
// release carries one archive per platform, and this script fetches only the
// one the host needs.
//
// `gpucap` is optional. Without it, captions render with ffmpeg's drawtext —
// which is what they did before this existed. Nothing here is a hard failure.
//
// Modes:
//   (no args)      install for this platform, print progress + result
//   --print-path   print ONLY the resolved binary path (nothing on failure)
//   --check        exit 0 when a binary is already present, 1 otherwise
//
// Source: the kino release tagged with the package version.
// License: MIT (same as kino).

import { execFileSync } from "node:child_process";
import { chmodSync, createWriteStream, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { get } from "node:https";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const REPO = "glitchoff/kino";

function platformTag() {
  const os = process.platform === "win32" ? "win32" : process.platform;
  return `${os}-${process.arch}`;
}

function binaryName() {
  return process.platform === "win32" ? "gpucap.exe" : "gpucap";
}

function targetPath() {
  return join(ROOT, "bin", platformTag(), binaryName());
}

function packageVersion() {
  const pkg = JSON.parse(
    execFileSync(process.execPath, ["-e", "process.stdout.write(JSON.stringify(require('./package.json')))"], {
      cwd: ROOT,
      encoding: "utf8",
    })
  );
  return pkg.version;
}

function download(url, dest) {
  return new Promise((resolvePromise, reject) => {
    const follow = (u, hops = 0) => {
      if (hops > 5) return reject(new Error(`too many redirects: ${url}`));
      get(u, { headers: { "user-agent": "kino-gpucap-installer" } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return follow(res.headers.location, hops + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        }
        const file = createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => file.close(() => resolvePromise(dest)));
        file.on("error", reject);
      }).on("error", reject);
    };
    follow(url);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const target = targetPath();

  if (args.includes("--print-path")) {
    if (existsSync(target)) process.stdout.write(target);
    return 0;
  }
  if (args.includes("--check")) {
    return existsSync(target) ? 0 : 1;
  }

  if (existsSync(target)) {
    console.log(`gpucap already installed: ${target}`);
    return 0;
  }

  const version = packageVersion();
  const tag = `v${version}`;
  const asset = `gpucap-${platformTag()}.zip`;
  const url = `https://github.com/${REPO}/releases/download/${tag}/${asset}`;

  const work = join(tmpdir(), `kino-gpucap-${process.pid}`);
  mkdirSync(work, { recursive: true });
  const zip = join(work, asset);

  console.log(`downloading ${asset} from ${tag} ...`);
  try {
    await download(url, zip);
  } catch (error) {
    console.log(`gpucap is not available for ${platformTag()} at ${tag}.`);
    console.log(`  ${error.message}`);
    console.log("Captions will use drawtext. This is not an error.");
    rmSync(work, { recursive: true, force: true });
    return 0;
  }

  mkdirSync(dirname(target), { recursive: true });
  // Unzip with the platform tool: a zip dependency is not worth it for one file.
  if (process.platform === "win32") {
    execFileSync("powershell", [
      "-NoProfile", "-Command",
      `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dirname(target)}' -Force`,
    ], { stdio: "inherit" });
  } else {
    execFileSync("unzip", ["-o", zip, "-d", dirname(target)], { stdio: "inherit" });
  }

  if (!existsSync(target)) {
    console.log(`archive did not contain ${binaryName()}; captions will use drawtext.`);
    rmSync(work, { recursive: true, force: true });
    return 0;
  }
  if (process.platform !== "win32") chmodSync(target, 0o755);

  const size = (statSync(target).size / 1024 / 1024).toFixed(1);
  console.log(`installed ${target} (${size} MB)`);
  rmSync(work, { recursive: true, force: true });
  return 0;
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error(`gpucap install failed: ${error.message}`);
  console.error("Captions will use drawtext. This is not a fatal error.");
  process.exit(0);
});
