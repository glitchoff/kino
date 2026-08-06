export type VideoEncoder =
  | "libx264"
  | "h264_nvenc"
  | "hevc_nvenc"
  | "h264_qsv"
  | "h264_amf"
  | "h264_videotoolbox"
  | "auto";

export interface RenderOptions {
  output: string;
  ffmpegPath?: string;
  overwrite?: boolean;
  verbose?: boolean;
  encoder?: VideoEncoder;
  preset?: string;
  kinoPath?: string;
  unsafeInlineText?: boolean;
  browserPath?: string;
}

export interface CompileResult {
  args: string[];
  filtergraph?: string;
  kinoFilePath: string;
}
