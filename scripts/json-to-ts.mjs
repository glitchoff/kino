#!/usr/bin/env node
// Convert a legacy JSON composition into a TypeScript composition module that
// uses the builder API.
//
//   node scripts/json-to-ts.mjs examples/basic.json
//   node scripts/json-to-ts.mjs examples/basic.json -o examples/basic.ts
//   node scripts/json-to-ts.mjs examples/*.json --out-dir examples/
//
// The generated module imports only what it uses and `export default`s the
// composition, so `npx kino <file>.ts` renders it directly.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

const RESERVED = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default",
  "delete", "do", "else", "enum", "export", "extends", "false", "finally", "for",
  "function", "if", "import", "in", "instanceof", "new", "null", "return", "super",
  "switch", "this", "throw", "true", "try", "typeof", "var", "void", "while", "with",
  "yield", "let", "static", "await", "async", "implements", "interface", "package",
  "private", "protected", "public",
]);

/** camelCase a JSON key into a safe identifier fragment. */
function camel(key) {
  return key.replace(/[-_]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ""));
}

/** `scene-1-earth` -> `scene1Earth`; falls back to a generic name. */
function identifierFrom(raw, fallback) {
  const base = camel(String(raw).replace(/[^A-Za-z0-9_-]+/g, " ").trim().replace(/\s+/g, "-"));
  if (!base || /^[0-9]/.test(base)) return fallback;
  return RESERVED.has(base) ? `${base}Composition` : base;
}

function quote(value) {
  return JSON.stringify(value);
}

/** Emit a JS literal for a value, with long strings kept on one line. */
function literal(value, indent = 0) {
  if (value === null) return "null";
  if (typeof value === "string") return quote(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const pad = "  ".repeat(indent + 1);
  const close = "  ".repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return `[\n${value.map((v) => `${pad}${literal(v, indent + 1)},`).join("\n")}\n${close}]`;
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  if (!entries.length) return "{}";
  return `{\n${entries.map(([k, v]) => `${pad}${keyName(k)}: ${literal(v, indent + 1)},`).join("\n")}\n${close}}`;
}

function keyName(key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : quote(key);
}

// --- element conversion -----------------------------------------------------

/** Map a text element's JSON fields onto builder option names. */
function textOptions(el) {
  const options = {};
  const map = {
    fontSize: "fontSize",
    fontColor: "color",
    fontFile: "fontFile",
    box: "box",
    boxColor: "boxColor",
    boxPadding: "boxPadding",
    maxWidth: "maxWidth",
    textAlign: "align",
    lineHeight: "lineHeight",
    stroke: "stroke",
    shadow: "shadow",
    id: "id",
    x: "x",
    y: "y",
    offsetX: "offsetX",
    offsetY: "offsetY",
    startAt: "startAt",
    duration: "duration",
    zIndex: "zIndex",
    sfx: "sfx",
    animation: "animation",
  };
  for (const [from, to] of Object.entries(map)) {
    if (el[from] !== undefined) options[to] = el[from];
  }
  return options;
}

function mediaOptions(el) {
  const options = {};
  for (const key of ["width", "height", "fit", "id", "x", "y", "offsetX", "offsetY", "startAt", "duration", "zIndex", "sfx", "animation"]) {
    if (el[key] !== undefined) options[key] = el[key];
  }
  if (el.type === "video") {
    for (const key of ["trimStart", "loop", "volume"]) {
      if (el[key] !== undefined) options[key] = el[key];
    }
  }
  return options;
}

function htmlOptions(el) {
  const options = {};
  for (const key of ["width", "height", "css", "fit", "backgroundColor", "deviceScaleFactor", "id", "x", "y", "offsetX", "offsetY", "startAt", "duration", "zIndex", "sfx", "animation"]) {
    if (el[key] !== undefined) options[key] = el[key];
  }
  return options;
}

/** Can this element be expressed with a builder helper? */
function convertible(el) {
  if (el.template !== undefined) return false;
  if (el.type === "text" || el.type === undefined) return typeof el.content === "string";
  if (el.type === "image" || el.type === "video") return typeof el.src === "string";
  if (el.type === "html") return typeof el.html === "string";
  return false;
}

function convertElement(el, indent) {
  const pad = "  ".repeat(indent);
  if (!convertible(el)) return `${pad}add(${literal(el, indent)})`;

  if (el.type === "text" || el.type === undefined) {
    return `${pad}text(${quote(el.content)}, ${literal(textOptions(el), indent)})`;
  }
  if (el.type === "image") {
    return `${pad}image(${quote(el.src)}, ${literal(mediaOptions(el), indent)})`;
  }
  if (el.type === "video") {
    return `${pad}video(${quote(el.src)}, ${literal(mediaOptions(el), indent)})`;
  }
  if (el.type === "html") {
    return `${pad}html(${quote(el.html)}, ${literal(htmlOptions(el), indent)})`;
  }
  return `${pad}add(${literal(el, indent)})`;
}

// --- composition conversion -------------------------------------------------

export function convert(json, { name } = {}) {
  const used = new Set();
  const warnings = [];

  const compOptions = {};
  for (const key of ["width", "height", "fps", "audio"]) {
    if (json[key] !== undefined) compOptions[key] = json[key];
  }
  if (json.templates?.length) compOptions.templates = json.templates;

  const sceneBlocks = (json.scenes ?? []).map((scene, index) => {
    const sceneOptions = {};
    for (const key of ["id", "duration", "background", "transition"]) {
      if (scene[key] !== undefined) sceneOptions[key] = scene[key];
    }

    const elements = scene.elements ?? [];
    const chain = elements
      .map((el, i) => {
        const expr = convertElement(el, 3).trimStart();
        // First element starts from the scene builder; the rest chain off it.
        return i === 0 ? `      s.${expr}` : `      .${expr}`;
      })
      .join("\n");

    const usesHelper = elements.some((el) => convertible(el));
    if (usesHelper) used.add("composition");
    if (elements.some((el) => el.type === "text" || el.type === undefined)) used.add("text");
    if (elements.some((el) => el.type === "image")) used.add("image");
    if (elements.some((el) => el.type === "video")) used.add("video");
    if (elements.some((el) => el.type === "html")) used.add("html");
    if (elements.some((el) => !convertible(el))) {
      warnings.push(`scene ${index + 1}: ${elements.filter((el) => !convertible(el)).length} element(s) emitted via add() (template or unsupported type)`);
    }

    const body = chain ? `\n${chain}\n    ` : " ";
    return `  .scene(${literal(sceneOptions, 1)}, (s) =>${body})`;
  });

  used.add("composition");

  const importList = [...used].sort();
  const varName = name ?? "composition";

  const header = [
    "// Generated by scripts/json-to-ts.mjs — edit freely, this is now source.",
    `import { ${importList.join(", ")} } from "@glitchoff/kino";`,
    "",
  ];

  const lines = [];
  lines.push(`const ${varName} = composition(${literal(compOptions, 0)})`);
  for (const block of sceneBlocks) {
    // Rewrite the leading indentation so chained calls line up.
    lines.push(block.replace(/^\s*\.scene/, "  .scene"));
  }
  lines.push("  .build();");
  lines.push("");
  lines.push(`export default ${varName};`);

  return { code: [...header, ...lines].join("\n") + "\n", warnings, importList };
}

// --- CLI --------------------------------------------------------------------

function parseArgs(argv) {
  const files = [];
  let out;
  let outDir;
  let quiet = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-o" || arg === "--out") out = argv[++i];
    else if (arg === "--out-dir") outDir = argv[++i];
    else if (arg === "-q" || arg === "--quiet") quiet = true;
    else if (arg === "-h" || arg === "--help") {
      console.log(`Usage: node scripts/json-to-ts.mjs <file.json...> [-o out.ts | --out-dir dir] [-q]

Converts legacy JSON compositions into TypeScript modules using the builder API.
Writes next to each input as <name>.ts unless -o / --out-dir is given.`);
      process.exit(0);
    } else if (!arg.startsWith("-")) files.push(arg);
  }
  return { files, out, outDir, quiet };
}

function targetFor(file, { out, outDir }) {
  if (out) return out;
  const base = basename(file, extname(file)) + ".ts";
  return outDir ? join(outDir, base) : join(dirname(file), base);
}

async function main() {
  const { files, out, outDir, quiet } = parseArgs(process.argv.slice(2));
  if (!files.length) {
    console.error("Usage: node scripts/json-to-ts.mjs <file.json...> [-o out.ts | --out-dir dir]");
    process.exit(1);
  }
  if (out && files.length > 1) {
    console.error("-o only works with a single input; use --out-dir for several files.");
    process.exit(1);
  }

  let failed = 0;
  for (const file of files) {
    if (!existsSync(file)) {
      console.error(`[json-to-ts] not found: ${file}`);
      failed++;
      continue;
    }
    let json;
    try {
      json = JSON.parse(readFileSync(file, "utf-8"));
    } catch (err) {
      console.error(`[json-to-ts] ${file}: invalid JSON — ${err.message}`);
      failed++;
      continue;
    }

    const target = targetFor(file, { out, outDir });
    const varName = identifierFrom(basename(file, extname(file)), "composition");
    const { code, warnings } = convert(json, { name: varName });
    writeFileSync(target, code);
    if (!quiet) {
      console.log(`[json-to-ts] ${file} -> ${target}`);
      for (const warning of warnings) console.warn(`  ! ${warning}`);
    }
  }
  if (failed) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
