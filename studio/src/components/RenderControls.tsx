import React from "react";
import { Play } from "lucide-react";
import { useStudioStore } from "../store/useStudioStore";

const X264_PRESETS = [
  ["veryfast", "Very Fast (Recommended)"],
  ["ultrafast", "Ultra Fast (Max Speed)"],
  ["medium", "Balanced (Medium)"],
  ["slow", "High Quality (Slow)"],
];
const NVENC_PRESETS = [
  ["p2", "p2 (Fast)"],
  ["p1", "p1 (Fastest)"],
  ["p4", "p4 (Balanced)"],
  ["p6", "p6 (High Quality)"],
  ["p7", "p7 (Slowest)"],
];
const AMF_PRESETS = [
  ["speed", "Speed"],
  ["balanced", "Balanced"],
  ["quality", "Quality"],
];
const VT_PRESETS = [["default", "Default"]];

const ENCODER_PRESETS: Record<string, string[][]> = {
  auto: X264_PRESETS,
  libx264: X264_PRESETS,
  h264_qsv: X264_PRESETS,
  h264_nvenc: NVENC_PRESETS,
  hevc_nvenc: NVENC_PRESETS,
  h264_amf: AMF_PRESETS,
  h264_videotoolbox: VT_PRESETS,
};

export const RenderControls: React.FC = () => {
  const {
    encoder,
    setEncoder,
    preset,
    setPreset,
    isRendering,
    renderStatusMsg,
    renderStatusType,
    renderVideo,
    composition,
  } = useStudioStore();

  const speedOptions = ENCODER_PRESETS[encoder] || X264_PRESETS;

  const handleEncoderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextEnc = e.target.value;
    setEncoder(nextEnc);
    const opts = ENCODER_PRESETS[nextEnc] || X264_PRESETS;
    if (opts.length > 0 && !opts.some(([v]) => v === preset)) {
      setPreset(opts[0][0]);
    }
  };

  let metaText = "—";
  if (composition) {
    const { width, height, fps } = composition;
    const sceneCount = (composition.scenes || []).length;
    const parts = [];
    if (width && height) parts.push(`${width}×${height}`);
    if (fps) parts.push(`${fps}fps`);
    if (sceneCount) parts.push(`${sceneCount} scene${sceneCount > 1 ? "s" : ""}`);
    metaText = parts.join(" · ") || "—";
  }

  let statusClass = "status-message";
  if (renderStatusType === "error") statusClass += " error";
  if (renderStatusType === "success") statusClass += " success";
  if (renderStatusType === "rendering") statusClass += " rendering";

  return (
    <>
      <div className="render-card">
        <div className="control-group">
          <label htmlFor="encoder-select">Encoder</label>
          <select
            id="encoder-select"
            className="preset-dropdown"
            value={encoder}
            onChange={handleEncoderChange}
          >
            <option value="auto">Auto (GPU / CPU Fallback)</option>
            <option value="h264_nvenc">NVIDIA GPU (h264_nvenc)</option>
            <option value="hevc_nvenc">NVIDIA HEVC (hevc_nvenc)</option>
            <option value="libx264">CPU (libx264)</option>
            <option value="h264_qsv">Intel QSV (h264_qsv)</option>
            <option value="h264_amf">AMD AMF (h264_amf)</option>
            <option value="h264_videotoolbox">Apple VideoToolbox</option>
          </select>
        </div>

        <div className="control-group">
          <label htmlFor="speed-select">Quality</label>
          <select
            id="speed-select"
            className="preset-dropdown"
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
          >
            {speedOptions.map(([val, label]) => (
              <option key={val} value={val}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <button
          className="btn btn-primary btn-lg"
          disabled={isRendering}
          onClick={() => renderVideo()}
        >
          <Play className="btn-lg-icon" />
          <span>{isRendering ? "Rendering…" : "Render Video"}</span>
        </button>
      </div>

      <div className="render-meta">
        <span className="meta-item">{metaText}</span>
        <span className={statusClass}>{renderStatusMsg}</span>
        {isRendering && <span className="spinner" />}
      </div>
    </>
  );
};
