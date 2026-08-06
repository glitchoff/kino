import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TextElement } from "../../types/index.js";
import { buildAnimationExpressions } from "../../animation/index.js";
import {
  escapeFFmpegStr,
  escapeExpr,
  formatTextBasePosition,
} from "../position.js";
import { normalizeColor } from "../position.js";

export function buildTextFilter(
  item: TextElement,
  elemIdx: number,
  stagingDir: string,
  sceneDur: number,
  useTextFiles: boolean,
  defaultFontRef: string | undefined,
  stageAsset: (src: string) => string
): string {
  const content = item.content || "";
  const fontSize = item.fontSize ?? 48;
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
    const lineSpacing = Math.round(fontSize * (item.lineHeight - 1));
    filter += `:line_spacing=${lineSpacing}`;
  }
  if (item.stroke) {
    filter += `:bordercolor=${normalizeColor(item.stroke.color)}:borderw=${item.stroke.width}`;
  }
  if (item.shadow) {
    filter += `:shadowcolor=${normalizeColor(item.shadow.color)}:shadowx=${item.shadow.x ?? 2}:shadowy=${item.shadow.y ?? 2}`;
  }
  if (item.box) {
    filter += `:box=1:boxcolor=${item.boxColor || "black@0.5"}:boxborderw=${item.boxPadding ?? 10}`;
  }
  if (item.fontFile) {
    filter += `:fontfile='${escapeFFmpegStr(stageAsset(item.fontFile))}'`;
  } else if (defaultFontRef) {
    filter += `:fontfile='${defaultFontRef}'`;
  }

  const startVal = item.startAt ?? 0;
  const endVal = item.duration !== undefined ? startVal + item.duration : sceneDur;
  filter += `:enable='between(t\\,${startVal}\\,${endVal})'`;

  return filter;
}
