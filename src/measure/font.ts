import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Advance widths read straight out of a font file.
 *
 * Rasterising text and finding its ink extent gives the wrong number: drawtext
 * positions on *advance width*, which includes the side bearings, so a
 * rasterised measurement lands a few pixels off and costs an ffmpeg process per
 * string. Reading `hmtx` is exact, synchronous, and needs no subprocess.
 */

interface Table {
  offset: number;
  length: number;
}

export interface FontMetrics {
  unitsPerEm: number;
  /** Advance width per glyph, in font units. */
  advances: number[];
  /** Character → glyph id. */
  cmap: Map<number, number>;
  /** `kern` pair adjustments in font units, keyed by `left << 16 | right`. */
  kerning: Map<number, number>;
  /** True when the font has no `kern` table, so pairs are not adjusted. */
  hasKerning: boolean;
}

function readTables(buf: Buffer): Map<string, Table> {
  const numTables = buf.readUInt16BE(4);
  const tables = new Map<string, Table>();
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    tables.set(buf.toString("ascii", o, o + 4), {
      offset: buf.readUInt32BE(o + 8),
      length: buf.readUInt32BE(o + 12),
    });
  }
  return tables;
}

/** `cmap` formats 4 (BMP) and 12 (full Unicode) cover practically everything. */
function readCmap(buf: Buffer, table: Table): Map<number, number> {
  const base = table.offset;
  const numSub = buf.readUInt16BE(base + 2);
  const cmap = new Map<number, number>();

  let best = -1;
  let bestScore = -1;
  for (let i = 0; i < numSub; i++) {
    const rec = base + 4 + i * 8;
    const platform = buf.readUInt16BE(rec);
    const encoding = buf.readUInt16BE(rec + 2);
    const offset = buf.readUInt32BE(rec + 4);
    const format = buf.readUInt16BE(base + offset);
    // Prefer format 12 (full Unicode), then a Unicode-platform format 4.
    let score = 0;
    if (format === 12) score = 3;
    else if (format === 4 && platform === 3 && encoding === 1) score = 2;
    else if (format === 4 && platform === 0) score = 1;
    if (score > bestScore) {
      bestScore = score;
      best = base + offset;
    }
  }
  if (best < 0) return cmap;

  const format = buf.readUInt16BE(best);
  if (format === 4) {
    const segCountX2 = buf.readUInt16BE(best + 6);
    const segCount = segCountX2 / 2;
    const endBase = best + 14;
    const startBase = endBase + segCountX2 + 2;
    const deltaBase = startBase + segCountX2;
    const rangeBase = deltaBase + segCountX2;

    for (let s = 0; s < segCount; s++) {
      const end = buf.readUInt16BE(endBase + s * 2);
      const start = buf.readUInt16BE(startBase + s * 2);
      const delta = buf.readInt16BE(deltaBase + s * 2);
      const rangeOffset = buf.readUInt16BE(rangeBase + s * 2);
      if (start === 0xffff) continue;
      for (let c = start; c <= end && c !== 0x10000; c++) {
        let glyph: number;
        if (rangeOffset === 0) {
          glyph = (c + delta) & 0xffff;
        } else {
          const idx = rangeBase + s * 2 + rangeOffset + (c - start) * 2;
          if (idx + 1 >= buf.length) continue;
          glyph = buf.readUInt16BE(idx);
          if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
        }
        if (glyph !== 0) cmap.set(c, glyph);
      }
    }
  } else if (format === 12) {
    const numGroups = buf.readUInt32BE(best + 12);
    for (let g = 0; g < numGroups; g++) {
      const o = best + 16 + g * 12;
      const start = buf.readUInt32BE(o);
      const end = buf.readUInt32BE(o + 4);
      const startGlyph = buf.readUInt32BE(o + 8);
      for (let c = start; c <= end; c++) cmap.set(c, startGlyph + (c - start));
    }
  }
  return cmap;
}

/**
 * `kern` format 0 pairs. Old and limited — Inter's real pair data is in `GPOS`,
 * which needs a shaper to apply. Format 0 is what is cheap to read, and the
 * difference for a headline is a pixel or two.
 */
function readKern(buf: Buffer, table: Table | undefined): Map<number, number> {
  const kern = new Map<number, number>();
  if (!table) return kern;
  const base = table.offset;
  const version = buf.readUInt16BE(base);
  // Apple's kern table has a 32-bit version/header; Microsoft's is 16-bit.
  let nTables: number;
  let pos: number;
  if (version === 0) {
    nTables = buf.readUInt16BE(base + 2);
    pos = base + 4;
  } else {
    nTables = buf.readUInt32BE(base + 4);
    pos = base + 8;
  }
  for (let t = 0; t < nTables && pos + 6 <= buf.length; t++) {
    const subVersion = buf.readUInt16BE(pos);
    const subLength = buf.readUInt16BE(pos + 2);
    const coverage = buf.readUInt16BE(pos + 4);
    const format = coverage >> 8;
    if (subVersion === 0 && format === 0) {
      const nPairs = buf.readUInt16BE(pos + 6);
      for (let p = 0; p < nPairs; p++) {
        const o = pos + 14 + p * 6;
        if (o + 5 >= buf.length) break;
        const left = buf.readUInt16BE(o);
        const right = buf.readUInt16BE(o + 2);
        kern.set((left << 16) | right, buf.readInt16BE(o + 4));
      }
    }
    pos += subLength || 6;
  }
  return kern;
}

const cache = new Map<string, FontMetrics>();

/** Parse a font once; the result is cached by path. */
export function loadFontMetrics(path: string): FontMetrics {
  const key = resolve(path);
  const hit = cache.get(key);
  if (hit) return hit;

  const buf = readFileSync(key);
  const tables = readTables(buf);

  const head = tables.get("head");
  const hhea = tables.get("hhea");
  const hmtx = tables.get("hmtx");
  const cmapTable = tables.get("cmap");
  if (!head || !hhea || !hmtx || !cmapTable) {
    throw new Error(`Font is missing a required table (head/hhea/hmtx/cmap): ${path}`);
  }

  const unitsPerEm = buf.readUInt16BE(head.offset + 18);
  const numberOfHMetrics = buf.readUInt16BE(hhea.offset + 34);

  // `hmtx` is numberOfHMetrics full records, then a bare left-side-bearing
  // array; glyphs past the end reuse the last advance.
  const advances: number[] = [];
  for (let i = 0; i < numberOfHMetrics; i++) {
    advances.push(buf.readUInt16BE(hmtx.offset + i * 4));
  }

  const metrics: FontMetrics = {
    unitsPerEm,
    advances,
    cmap: readCmap(buf, cmapTable),
    kerning: readKern(buf, tables.get("kern")),
    hasKerning: tables.has("kern"),
  };
  cache.set(key, metrics);
  return metrics;
}

/** Glyph id for a code point, or 0 (`.notdef`). */
export function glyphFor(metrics: FontMetrics, codePoint: number): number {
  return metrics.cmap.get(codePoint) ?? 0;
}

/** Advance width of a glyph, in font units. */
export function glyphAdvance(metrics: FontMetrics, glyph: number): number {
  if (metrics.advances.length === 0) return 0;
  return metrics.advances[Math.min(glyph, metrics.advances.length - 1)];
}

/**
 * Advance width of a string in pixels.
 *
 * This is the number drawtext uses for `text_w`, so a layout computed from it
 * lands exactly where the render does.
 */
export function advanceWidth(metrics: FontMetrics, text: string, fontSize: number): number {
  let total = 0;
  let prev = -1;
  for (const ch of text) {
    const glyph = glyphFor(metrics, ch.codePointAt(0)!);
    if (prev >= 0 && metrics.kerning.size > 0) {
      total += metrics.kerning.get((prev << 16) | glyph) ?? 0;
    }
    total += glyphAdvance(metrics, glyph);
    prev = glyph;
  }
  return (total / metrics.unitsPerEm) * fontSize;
}

/** The bundled font, found from the package root. */
function findBundledFont(): string | undefined {
  let dir = resolve(
    typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url))
  );
  for (let i = 0; i < 5; i++) {
    for (const name of ["Inter-Regular.ttf", "inter-regular.ttf"]) {
      const path = join(dir, "assets", name);
      if (existsSync(path)) return path;
    }
    dir = dirname(dir);
  }
  return undefined;
}

let bundled: string | undefined | null = null;

export function bundledFontFile(): string | undefined {
  if (bundled === null) bundled = findBundledFont();
  return bundled;
}
