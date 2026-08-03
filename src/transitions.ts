import type { KinoTransitionType } from "./types.js";

export function mapTransitionType(type: KinoTransitionType | string): string {
  switch (type) {
    case "fade":
      return "fade";
    case "slideLeft":
      return "slideleft";
    case "slideRight":
      return "slideright";
    case "slideUp":
      return "slideup";
    case "slideDown":
      return "slidedown";
    case "wipeLeft":
      return "wipeleft";
    case "wipeRight":
      return "wiperight";
    case "wipeUp":
      return "wipeup";
    case "wipeDown":
      return "wipedown";
    case "zoomIn":
      return "zoomin";
    case "zoomOut":
      return "rectcrop";
    default:
      return "fade";
  }
}
