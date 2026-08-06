import type { BackgroundInput, BackgroundConfig } from "../types/index.js";

export function normalizeBackground(bg?: BackgroundInput): BackgroundConfig {
  if (!bg) {
    return { type: "color", value: "#000000" };
  }
  if (typeof bg === "string") {
    return { type: "color", value: bg };
  }
  return bg;
}
