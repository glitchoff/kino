export interface AudioTrack {
  src: string;
  startTime?: number | string;
  offset?: number | string;
  duration?: number | string;
  volume?: number | string;
  loop?: boolean;
  fadeIn?: number | string;
  fadeOut?: number | string;
}
