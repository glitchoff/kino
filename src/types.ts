export interface TextOverlay {
  content: string;
  fontSize?: number;
  fontColor?: string;
  x?: number | string;
  y?: number | string;
  startTime?: number;
  duration?: number;
  fontFile?: string;
}

export interface KinoComposition {
  width: number;
  height: number;
  duration: number;
  background?: string;
  fps?: number;
  text?: TextOverlay | TextOverlay[];
  elements?: TextOverlay[];
}

export interface RenderOptions {
  output: string;
  ffmpegPath?: string;
  overwrite?: boolean;
  verbose?: boolean;
}

export interface CompileResult {
  args: string[];
  filtergraph?: string;
}
