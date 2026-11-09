import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { NormalizedTextElement, TextElement } from "../../types/index.js";
import { buildAnimationExpressions } from "../../animation/index.js";
import {
  escapeFFmpegStr,
  escapeExpr,
  formatTextBasePosition,
} from "../position.js";
import { normalizeColor } from "../position.js";
import { parseDuration, parseLineHeight, parsePixels } from "../../normalize/unit-parser.js";
import { estimateTextWidth, wrapText } from "../../normalize/element.js";

/** Expands CSS shorthand (`#fff`) while preserving `@alpha` suffixes. */
function normalizeTextColor(color: string | undefined, fallback: string): string {
  if (!color) return fallback;
  const [base, alpha] = color.split("@");
  return `${normalizeColor(base)}${alpha !== undefined ? `@${alpha}` : ""}`;
}

export function buildTextFilter(
  item: NormalizedTextElement | TextElement | any,
  elemIdx: number,
  stagingDir: string,
  sceneDur: number,
  useTextFiles: boolean,
  defaultFontRef: string | undefined,
  stageAsset: (src: string) => string
): string {
  const content = item.content || "";
  const fontSize = parsePixels(item.fontSize) ?? 48;
  // `#fff` must become `0xffffff`; drawtext rejects CSS shorthand.
  const fontColor = normalizeTextColor(item.fontColor, "white");

  let textRef: string;
  if (useTextFiles) {
    const name = `text-${elemIdx}.txt`;
    writeFileSync(join(stagingDir, name), content, "utf-8");
    textRef = `textfile='${escapeFFmpegStr(name)}'`;
  } else {
    textRef = `text='${escapeFFmpegStr(content)}'`;
  }

  const ax = buildAnimationExpressions(item, "t");
  const hasAnimProps = !!(ax.opacity || ax.tx || ax.ty || ax.scale);

  const staticX = formatTextBasePosition(item.x, item.offsetX, "(w-text_w)/2");
  const staticY = formatTextBasePosition(item.y, item.offsetY, "(h-text_h)/2");

  let filter: string;
  if (hasAnimProps) {
    let fsExpr = String(fontSize);
    let xExpr = staticX;
    let yExpr = staticY;
    if (ax.scale) {
      const scaleExpr = `max(0.01,(${ax.scale}))`;
      fsExpr = `${fontSize}*(${scaleExpr})`;
      xExpr += ` - (text_w*(1-(1/${scaleExpr})))/2`;
      yExpr += ` - (text_h*(1-(1/${scaleExpr})))/2`;
    }
    if (ax.tx) xExpr = `(${staticX}) + (${ax.tx})`;
    if (ax.ty) yExpr = `(${staticY}) + (${ax.ty})`;

    filter = `drawtext=${textRef}:fontsize='${escapeExpr(fsExpr)}':fontcolor=${fontColor}:x='${escapeExpr(xExpr)}':y='${escapeExpr(yExpr)}'`;
    if (ax.opacity) {
      filter += `:alpha='${escapeExpr(ax.opacity)}'`;
    }
  } else {
    filter = `drawtext=${textRef}:fontsize=${fontSize}:fontcolor=${fontColor}:x=${staticX}:y=${staticY}`;
  }

  if (item.textAlign) filter += `:text_align=${item.textAlign}`;
  if (item.lineHeight !== undefined) {
    const lh = parseLineHeight(item.lineHeight, fontSize) ?? 1.2;
    const lineSpacing = Math.round(fontSize * (lh - 1));
    filter += `:line_spacing=${lineSpacing}`;
  }
  if (item.stroke) {
    const strokeWidth = parsePixels(item.stroke.width) ?? 0;
    filter += `:bordercolor=${normalizeColor(item.stroke.color)}:borderw=${strokeWidth}`;
  }
  if (item.shadow) {
    const shadowX = parsePixels(item.shadow.x) ?? 2;
    const shadowY = parsePixels(item.shadow.y) ?? 2;
    filter += `:shadowcolor=${normalizeColor(item.shadow.color)}:shadowx=${shadowX}:shadowy=${shadowY}`;
  }
  if (item.box) {
    const boxPadding = parsePixels(item.boxPadding) ?? 10;
    filter += `:box=1:boxcolor=${normalizeTextColor(item.boxColor, "black@0.5")}:boxborderw=${boxPadding}`;
  }
  if (item.fontFile) {
    filter += `:fontfile='${escapeFFmpegStr(stageAsset(item.fontFile))}'`;
  } else if (defaultFontRef) {
    filter += `:fontfile='${defaultFontRef}'`;
  }

  const startVal = parseDuration(item.startAt) ?? 0;
  const itemDur = parseDuration(item.duration);
  const endVal = itemDur !== undefined ? startVal + itemDur : sceneDur;
  filter += `:enable='between(t\\,${startVal}\\,${endVal})'`;

  return filter;
}

// ---------------------------------------------------------------------------
// Karaoke captions
// ---------------------------------------------------------------------------

/** True when a text element carries per-word karaoke timings. */
export function hasCaptionWords(item: any): boolean {
  return Array.isArray(item?.captionWords) && item.captionWords.length > 0;
}

/**
 * Applies a karaoke sweep to a caption element.
 *
 * drawtext colours a whole string at once, so a per-word highlight cannot be
 * expressed as one filter. Instead the line is drawn dim, then split: one copy
 * is drawn in the highlight colour and cropped to the active word's box, and
 * that crop is overlaid back at the same position. Because the copy is the
 * same text at the same font size and origin, the crop lines up with the word
 * exactly, and only the cropped word is ever visible in the highlight colour.
 *
 * Word boxes are estimated from character widths in the font. A monospace
 * measurement would be wrong for proportional fonts, so each character is
 * weighted — wide letters (`m`, `w`) get more, narrow ones (`i`, `l`) less.
 * This is a close approximation, not a glyph-accurate measurement: the crop is
 * padded by a few pixels so a slightly wide word is never cut mid-glyph.
 */
export function buildKaraokeFilters(
  item: any,
  dimFilter: string,
  inPad: string,
  outPad: string,
  sceneDur: number
): string[] {
  const words: Array<{ word: string; at: number; duration: number }> = item.captionWords;
  const content: string = item.content || "";
  const startAt = parseDuration(item.startAt) ?? 0;
  const fontSize = parsePixels(item.fontSize) ?? 48;
  const highlight = normalizeTextColor(item.highlight, "0x38bdf8");
  const textRef = item.__textRef as string | undefined;
  if (!textRef) return [`${inPad}${dimFilter}${outPad}`];

  // Where the text sits, in pixels from the frame's top-left.
  //
  // drawtext calls the frame `w`/`h`, crop calls it `in_w`/`in_h`, and overlay
  // calls it `main_w`/`main_h`. Rather than rely on any of those, positions are
  // computed against the frame size known at compile time — the same in every
  // filter. The highlight copy is drawn with `main_w`/`main_h` substituted for
  // `w`/`h` so its expressions mean the same thing inside crop/overlay.
  const frameW = item.__frameWidth as number | undefined;
  const frameH = item.__frameHeight as number | undefined;
  if (!frameW || !frameH) {
    // Without a frame size the offsets cannot be resolved; fall back to the
    // dim line alone rather than emit a broken graph.
    return [`${inPad}${dimFilter}${outPad}`];
  }

  const align = item.textAlign ?? "center";
  const padPx = Math.max(2, Math.round(fontSize * 0.12));

  // Captions wrap, so a word's box depends on which line it landed on. The
  // normalizer has already wrapped `content` with its own estimator; reuse it
  // so the crop agrees with what drawtext renders.
  const lineHeight = (parseLineHeight(item.lineHeight, fontSize) ?? 1.2) * fontSize;
  const wrapped = wrapText(content, fontSize, parsePixels(item.maxWidth, frameW));
  const lines = wrapped.split("\n");
  const maxLinePx = Math.max(1e-6, ...lines.map((l) => estimateTextWidth(l, fontSize)));
  const totalTextH = lines.length * lineHeight;

  // Left edge of the text block, from the same expressions drawtext uses.
  const xBase = Number(
    resolvePx(formatTextBasePosition(item.x, item.offsetX, "(w-text_w)/2"), frameW, fontSize)
  );
  const blockLeft =
    align === "left"
      ? xBase
      : align === "right"
        ? xBase - maxLinePx
        : (frameW - maxLinePx) / 2;
  const blockTop = Number(
    resolvePx(formatTextBasePosition(item.y, item.offsetY, "(h-text_h)/2"), frameH, fontSize)
  );

  /** Frame coordinates of each word: its line and its x offset within it. */
  const wordBoxes = new Map<number, { left: number; top: number; width: number }>();
  let wordIndex = 0;
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const lineText = lines[lineIdx];
    const linePx = estimateTextWidth(lineText, fontSize);
    const lineLeft =
      align === "left" ? blockLeft : align === "right" ? blockLeft + (maxLinePx - linePx) : blockLeft + (maxLinePx - linePx) / 2;
    // Walk the line, tracking how far into it each word starts.
    let cursor = 0;
    for (const token of lineText.split(/(\s+)/)) {
      if (!token) continue;
      if (/^\s+$/.test(token)) {
        cursor += estimateTextWidth(token, fontSize);
        continue;
      }
      const width = estimateTextWidth(token, fontSize);
      if (wordIndex < words.length) {
        wordBoxes.set(wordIndex, {
          left: lineLeft + cursor,
          top: blockTop + lineIdx * lineHeight,
          width,
        });
      }
      wordIndex++;
      cursor += width;
    }
  }
  void totalTextH;

  // Same drawtext call, different colour. The copy's own element `enable` is
  // replaced by the word's window: leaving both would AND them together, and
  // the element's range ends before the last word's. `w`/`h` become
  // `main_w`/`main_h` because this copy is read inside crop and overlay, where
  // bare `w`/`h` mean the input size rather than the frame.
  const highlightFilter = dimFilter
    .replace(/:fontcolor=[^:']+/, `:fontcolor=${highlight}`)
    .replace(/:enable='[^']*'/, "")
    .replace(/\bw-text_w\b/g, "main_w-text_w")
    .replace(/\bh-text_h\b/g, "main_h-text_h");

  const chain: string[] = [];
  // One dim line to keep, plus one copy per word to recolour and crop.
  const wordLabels = words.map((_, i) => `[ka_dim_${i}]`);
  chain.push(`${inPad}${dimFilter},split=${words.length + 1}[ka_base]${wordLabels.join("")}`);

  // Overlay each highlighted word crop back onto a running frame.
  let prev = "[ka_base]";
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const box = wordBoxes.get(i);
    if (!box) continue;

    // The crop is padded so anti-aliased edges and italic overhang survive.
    const leftPx = (box.left - padPx).toFixed(3);
    const topPx = (box.top - padPx).toFixed(3);
    const wPx = (box.width + padPx * 2).toFixed(2);
    const hPx = (lineHeight + padPx * 2).toFixed(2);

    const t0 = (startAt + w.at).toFixed(4);
    const t1 = (startAt + w.at + w.duration).toFixed(4);
    const enable = `between(t\\,${t0}\\,${t1})`;

    const hl = `[ka_hl_${i}]`;
    const crop = `[ka_crop_${i}]`;
    chain.push(`${wordLabels[i]}${highlightFilter}:enable='${enable}'${hl}`);
    chain.push(`${hl}crop=w=${wPx}:h=${hPx}:x='${leftPx}':y='${topPx}'${crop}`);

    const next = `[ka_out_${i}]`;
    chain.push(`${prev}${crop}overlay=x='${leftPx}':y='${topPx}':format=auto${next}`);
    prev = next;
  }

  // A crop is the whole frame with one word recoloured, so it already carries
  // the dim line; the overlay is complete and needs no further blend.
  chain.push(`${prev}null${outPad}`);
  return chain;
}

/**
 * Resolves a drawtext position expression to a plain number against the frame.
 *
 * Handles the forms `formatTextBasePosition` produces: a bare number, `w-…`,
 * `h-…`, and `w`/`h` percentages. Anything it cannot evaluate returns `"0"`,
 * which puts the highlight at the frame origin rather than failing the render.
 */
/** Approximate rendered extent of the text, for centring a caption crop. */
function textExtent(which: string, fontSize: number): number {
  // drawtext's text_h for a single line is roughly the font size plus
  // leading; text_w is measured from the em-width estimate at the call site.
  return which === "text_h" ? fontSize * 1.2 : 0;
}

function resolvePx(expr: string, frame: number, fontSize: number): string {
  const value = evalExpr(expr, frame, fontSize);
  return value === undefined ? "0" : value.toFixed(3);
}

/**
 * Evaluates a drawtext position expression to a number.
 *
 * `formatTextBasePosition` produces nested forms like `((h-text_h)/2)+(240)`,
 * so this parses rather than pattern-matches: numbers, `w`/`h`, `text_w`/
 * `text_h`, and `+ - * /` with parentheses. Anything it cannot evaluate
 * returns `undefined` and the caller falls back to the dim line.
 */
function evalExpr(expr: string, frame: number, fontSize: number): number | undefined {
  let i = 0;
  const s = expr.replace(/\s+/g, "");

  const peek = () => s[i];
  const eat = (ch: string) => {
    if (s[i] === ch) {
      i++;
      return true;
    }
    return false;
  };

  // Grammar: expr := term (('+'|'-') term)*
  const parseExpr = (): number | undefined => {
    let left = parseTerm();
    if (left === undefined) return undefined;
    while (peek() === "+" || peek() === "-") {
      const op = s[i++];
      const right = parseTerm();
      if (right === undefined) return undefined;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  };

  const parseTerm = (): number | undefined => {
    let left = parseFactor();
    if (left === undefined) return undefined;
    while (peek() === "*" || peek() === "/") {
      const op = s[i++];
      const right = parseFactor();
      if (right === undefined) return undefined;
      if (op === "/" && right === 0) return undefined;
      left = op === "*" ? left * right : left / right;
    }
    return left;
  };

  const parseFactor = (): number | undefined => {
    if (eat("(")) {
      const value = parseExpr();
      return eat(")") ? value : undefined;
    }
    const num = s.slice(i).match(/^\d+(?:\.\d+)?/);
    if (num) {
      i += num[0].length;
      return parseFloat(num[0]);
    }
    const ident = s.slice(i).match(/^(text_w|text_h|[wh])/);
    if (ident) {
      i += ident[0].length;
      const name = ident[0];
      // Only the vertical extent matters for a caption crop; text_w would
      // require the rendered width, which the caller computes separately.
      if (name === "text_h") return textExtent("text_h", fontSize);
      if (name === "w" || name === "h") return frame;
      return undefined;
    }
    return undefined;
  };

  const result = parseExpr();
  return i === s.length ? result : undefined;
}

/** Rough advance width of a character in em units, for caption layout. */
function charEm(ch: string): number {
  if (ch === " ") return 0.28;
  if ("iljtfI.,:;'!|".includes(ch)) return 0.28;
  if ("mwMW".includes(ch)) return 0.9;
  if ("@".includes(ch)) return 0.95;
  if ("r".includes(ch)) return 0.38;
  if (ch >= "A" && ch <= "Z") return 0.66;
  if (ch >= "0" && ch <= "9") return 0.56;
  return 0.53;
}
