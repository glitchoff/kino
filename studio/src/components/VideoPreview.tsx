import React, { useRef, useEffect } from "react";
import { Download, Video } from "lucide-react";
import { useStudioStore } from "../store/useStudioStore";

export const VideoPreview: React.FC = () => {
  const { videoUrl, filename, composition } = useStudioStore();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoUrl && videoRef.current) {
      videoRef.current.src = videoUrl;
      videoRef.current.load();
      videoRef.current.play().catch(() => {});
    }
  }, [videoUrl]);

  let aspectRatio = "16 / 9";
  if (composition && composition.width && composition.height) {
    aspectRatio = `${composition.width} / ${composition.height}`;
  }

  return (
    <div className="video-card">
      <div className="card-header">
        <h3>Video Output</h3>
        {videoUrl && (
          <a
            href={videoUrl}
            download={filename || "kino-render.mp4"}
            className="download-btn"
          >
            <Download className="btn-sm-icon" /> Download .mp4
          </a>
        )}
      </div>
      <div className="video-wrapper" style={{ aspectRatio }}>
        {videoUrl ? (
          <video
            ref={videoRef}
            controls
            preload="auto"
            className="video-element"
          />
        ) : (
          <div className="video-placeholder">
            <span className="placeholder-icon-wrap">
              <Video className="placeholder-icon-svg" />
            </span>
            <p>
              Click <strong>Render Video</strong> to render and play the output here.
            </p>
            <p className="placeholder-hint">Tip: Ctrl/Cmd + Enter renders</p>
          </div>
        )}
      </div>
    </div>
  );
};
