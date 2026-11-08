import type { RenderOptions } from "./render.js";

/**
 * One still to write.
 *
 * A bare number means "the frame at this timestamp", named automatically. The
 * object form exists so a caller can give the file a stable name, which an agent
 * retrying a render can overwrite instead of accumulating `frame-1.5-2.png`.
 */
export type FrameRequest =
  | number
  | {
      /** Seconds from the start of the composition. */
      at: number;
      /** File stem, without extension. Defaults to `frame-<at>`. */
      name?: string;
      /** Defaults to `png`. */
      format?: "png" | "jpg" | "jpeg";
    };

/** A written still, with its bytes already read back. */
export interface FrameResult {
  /** The requested timestamp, in seconds. */
  at: number;
  /** Absolute path of the written file. */
  path: string;
  /**
   * The image as a data URL (`data:image/png;base64,…`).
   *
   * Returned because it is already in memory when the file is written. Pass it
   * straight to a vision model or an upload without touching the disk again.
   */
  data: string;
}

/**
 * What to export. Every field is independent: asking only for `frames` never
 * encodes a video.
 */
export interface ExportOptions extends Partial<RenderOptions> {
  /** Full-quality video. The value is the output path. */
  video?: string;
  /** Fast downscaled video, by height. `previewOutput` names the file. */
  preview?: boolean | number;
  /** Where the preview is written. Defaults to `preview.mp4`. */
  previewOutput?: string;
  /** Timestamps to write as stills. */
  frames?: FrameRequest[];
  /** Directory for the stills. Defaults to the working directory. */
  frameDir?: string;
}

/** Whatever was asked for, and nothing else. */
export interface ExportResult {
  video?: string;
  preview?: string;
  frames?: FrameResult[];
}
