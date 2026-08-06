import type {
  ElementInput,
  TextElement,
  ImageElement,
  HtmlElement,
  VideoElement,
} from "../types/index.js";

function getCharWidth(char: string, fontSize: number): number {
  if ("WwM@#%&".includes(char)) return fontSize * 0.8;
  if ("ilmI'|!.,:;()[]{}t-`".includes(char)) return fontSize * 0.28;
  if (char >= "A" && char <= "Z") return fontSize * 0.65;
  if (char === " ") return fontSize * 0.3;
  return fontSize * 0.52;
}

export function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of text) {
    width += getCharWidth(ch, fontSize);
  }
  return width;
}

export function wrapText(content: string, fontSize: number, maxWidth?: number): string {
  if (!maxWidth || maxWidth <= 0 || !content) return content;

  const existingLines = content.split("\n");
  const wrappedLines: string[] = [];

  for (const line of existingLines) {
    if (estimateTextWidth(line, fontSize) <= maxWidth) {
      wrappedLines.push(line);
      continue;
    }
    const words = line.split(" ");
    let currentLine = "";
    for (const word of words) {
      if (!currentLine) {
        currentLine = word;
      } else {
        const testLine = `${currentLine} ${word}`;
        if (estimateTextWidth(testLine, fontSize) <= maxWidth) {
          currentLine = testLine;
        } else {
          wrappedLines.push(currentLine);
          currentLine = word;
        }
      }
    }
    if (currentLine) wrappedLines.push(currentLine);
  }

  return wrappedLines.join("\n");
}

export function normalizeElement(elem: any): ElementInput {
  if (!elem) {
    return { type: "text", content: "" };
  }

  const startAt = elem.startAt ?? elem.startTime;

  if (elem.type === "image") {
    const img: ImageElement = {
      type: "image",
      src: elem.src || "",
      x: elem.x,
      y: elem.y,
      offsetX: elem.offsetX,
      offsetY: elem.offsetY,
      width: elem.width,
      height: elem.height,
      fit: elem.fit,
      startAt,
      startTime: elem.startTime,
      duration: elem.duration,
      sfx: elem.sfx,
      zIndex: elem.zIndex,
      animation: elem.animation,
    };
    return img;
  }

  if (elem.type === "html") {
    const html: HtmlElement = {
      type: "html",
      html: elem.html || "",
      css: elem.css,
      width: elem.width,
      height: elem.height,
      fit: elem.fit,
      backgroundColor: elem.backgroundColor,
      deviceScaleFactor: elem.deviceScaleFactor,
      x: elem.x,
      y: elem.y,
      offsetX: elem.offsetX,
      offsetY: elem.offsetY,
      startAt,
      startTime: elem.startTime,
      duration: elem.duration,
      sfx: elem.sfx,
      zIndex: elem.zIndex,
      animation: elem.animation,
    };
    return html;
  }

  if (elem.type === "video") {
    const fit = elem.fit ?? "contain";
    const vid: VideoElement = {
      type: "video",
      src: elem.src || "",
      x: elem.x,
      y: elem.y,
      offsetX: elem.offsetX,
      offsetY: elem.offsetY,
      width: elem.width,
      height: elem.height,
      fit,
      trimStart: elem.trimStart,
      loop: elem.loop,
      volume: elem.volume,
      startAt,
      startTime: elem.startTime,
      duration: elem.duration,
      sfx: elem.sfx,
      zIndex: elem.zIndex,
      animation: elem.animation,
    };
    return vid;
  }

  if (elem.maxWidth !== undefined && elem.maxWidth <= 0) {
    throw new Error(`Invalid TextElement 'maxWidth': ${elem.maxWidth}. Must be greater than 0.`);
  }
  if (elem.lineHeight !== undefined && elem.lineHeight <= 0) {
    throw new Error(`Invalid TextElement 'lineHeight': ${elem.lineHeight}. Must be greater than 0.`);
  }
  if (elem.stroke?.width !== undefined && elem.stroke.width < 0) {
    throw new Error(`Invalid TextElement 'stroke.width': ${elem.stroke.width}. Must be non-negative.`);
  }

  const rawContent = elem.content || "";
  const fontSize = elem.fontSize ?? 48;
  const content = elem.maxWidth ? wrapText(rawContent, fontSize, elem.maxWidth) : rawContent;

  const text: TextElement = {
    type: "text",
    content,
    fontSize: elem.fontSize,
    fontColor: elem.fontColor,
    fontFile: elem.fontFile,
    box: elem.box,
    boxColor: elem.boxColor,
    boxPadding: elem.boxPadding,
    maxWidth: elem.maxWidth,
    textAlign: elem.textAlign,
    lineHeight: elem.lineHeight,
    stroke: elem.stroke,
    shadow: elem.shadow,
    x: elem.x,
    y: elem.y,
    offsetX: elem.offsetX,
    offsetY: elem.offsetY,
    startAt,
    startTime: elem.startTime,
    duration: elem.duration,
    sfx: elem.sfx,
    zIndex: elem.zIndex,
    animation: elem.animation,
  };
  return text;
}
