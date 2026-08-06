export interface AudioTrack {
  src: string;
  startTime?: number;
  offset?: number;
  duration?: number;
  volume?: number;
  loop?: boolean;
  fadeIn?: number;
  fadeOut?: number;
}
