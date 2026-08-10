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
  const fontColor = item.fontColor ?? "white";

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
    filter += `:box=1:boxcolor=${item.boxColor || "black@0.5"}:boxborderw=${boxPadding}`;
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
