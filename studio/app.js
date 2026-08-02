let presets = {
  basic: {
    width: 1080,
    height: 1920,
    fps: 30,
    scenes: [
      {
        duration: 5,
        background: "#0f172a",
        elements: [
          {
            type: "text",
            content: "Hello Kino",
            fontSize: 72,
            fontColor: "white",
            box: true,
            boxColor: "black@0.6",
            boxPadding: 16,
            x: "center",
            y: "center",
            startTime: 0,
            duration: 3
          },
          {
            type: "text",
            content: "JSON to FFmpeg",
            fontSize: 48,
            fontColor: "#38bdf8",
            x: "center",
            y: "(h-text_h)/2+140",
            startTime: 2,
            duration: 3
          }
        ]
      }
    ]
  }
};

const jsonEditor = document.getElementById("json-editor");
const jsonStatus = document.getElementById("json-status");
const editorHighlight = document.getElementById("editor-highlight");
const editorHighlightCode = document.getElementById("editor-highlight-code");
const editorGutterPre = document.getElementById("editor-gutter-pre");
const presetSelect = document.getElementById("preset-select");
const formatJsonBtn = document.getElementById("format-json-btn");
const encoderSelect = document.getElementById("encoder-select");
const speedSelect = document.getElementById("speed-select");
const renderBtn = document.getElementById("render-btn");
const renderBtnLabel = document.getElementById("render-btn-label");
const renderSpinner = document.getElementById("render-spinner");
const renderStatusMsg = document.getElementById("render-status-msg");
const compositionMeta = document.getElementById("composition-meta");
const videoPlayer = document.getElementById("video-player");
const videoPlaceholder = document.getElementById("video-placeholder");
const downloadLink = document.getElementById("download-link");
const videoWrapper = document.querySelector(".video-wrapper");

const X264_PRESETS = [
  ["veryfast", "⚡ Very Fast"],
  ["ultrafast", "🚀 Ultra Fast"],
  ["medium", "⚖️ Balanced"],
  ["slow", "💎 High Quality"]
];
const NVENC_PRESETS = [
  ["p2", "⚡ p2 (Fast)"],
  ["p1", "p1 (Fastest)"],
  ["p4", "⚖️ p4 (Balanced)"],
  ["p6", "💎 p6 (High Quality)"],
  ["p7", "p7 (Slowest)"]
];
const AMF_PRESETS = [
  ["speed", "⚡ Speed"],
  ["balanced", "⚖️ Balanced"],
  ["quality", "💎 Quality"]
];
const VT_PRESETS = [["default", "Default"]];

const ENCODER_PRESETS = {
  auto: X264_PRESETS,
  libx264: X264_PRESETS,
  h264_qsv: X264_PRESETS,
  h264_nvenc: NVENC_PRESETS,
  hevc_nvenc: NVENC_PRESETS,
  h264_amf: AMF_PRESETS,
  h264_videotoolbox: VT_PRESETS
};

function rebuildSpeedSelect(encoder) {
  const options = ENCODER_PRESETS[encoder] || X264_PRESETS;
  speedSelect.innerHTML = "";
  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    speedSelect.appendChild(option);
  }
}

let currentComposition = null;
let currentAspectRatio = null;

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function highlightJson(src) {
  const tokenRe =
    /("(?:\\.|[^"\\])*")(?=\s*:)|("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b)|(\bnull\b)|([{}[\],:])/g;
  let out = "";
  let last = 0;
  let m;
  tokenRe.lastIndex = 0;
  while ((m = tokenRe.exec(src)) !== null) {
    out += escapeHtml(src.slice(last, m.index));
    const [full, key, str, num, bool, nul, punct] = m;
    if (key !== undefined) out += `<span class="tok-key">${escapeHtml(key)}</span>`;
    else if (str !== undefined) out += `<span class="tok-string">${escapeHtml(str)}</span>`;
    else if (num !== undefined) out += `<span class="tok-number">${escapeHtml(num)}</span>`;
    else if (bool !== undefined) out += `<span class="tok-bool">${escapeHtml(bool)}</span>`;
    else if (nul !== undefined) out += `<span class="tok-null">${escapeHtml(nul)}</span>`;
    else if (punct !== undefined) out += `<span class="tok-punct">${escapeHtml(punct)}</span>`;
    last = m.index + full.length;
  }
  out += escapeHtml(src.slice(last));
  return out;
}

function updateHighlight() {
  const st = jsonEditor.scrollTop;
  const sl = jsonEditor.scrollLeft;
  editorHighlightCode.innerHTML = highlightJson(jsonEditor.value);
  editorHighlight.scrollTop = st;
  editorHighlight.scrollLeft = sl;
}

function updateLineNumbers() {
  const count = jsonEditor.value.split("\n").length;
  let lines = "";
  for (let i = 1; i <= count; i++) {
    lines += `${i}\n`;
  }
  editorGutterPre.textContent = lines.replace(/\n$/, "");
}

function updateMeta() {
  if (!currentComposition) {
    compositionMeta.textContent = "—";
    return;
  }
  const { width, height, fps } = currentComposition;
  const sceneCount = (currentComposition.scenes || []).length;
  const parts = [];
  if (width && height) parts.push(`${width}×${height}`);
  if (fps) parts.push(`${fps}fps`);
  if (sceneCount) parts.push(`${sceneCount} scene${sceneCount > 1 ? "s" : ""}`);
  compositionMeta.textContent = parts.join(" · ") || "—";
}

function updatePreviewAspectRatio() {
  let ratio = "16 / 9";
  if (currentComposition && currentComposition.width && currentComposition.height) {
    ratio = `${currentComposition.width} / ${currentComposition.height}`;
  }
  if (currentAspectRatio !== ratio) {
    currentAspectRatio = ratio;
    videoWrapper.style.aspectRatio = ratio;
  }
}

function onJsonChange() {
  updateHighlight();
  updateLineNumbers();
  try {
    const parsed = JSON.parse(jsonEditor.value);
    currentComposition = parsed;
    jsonStatus.textContent = "Valid JSON";
    jsonStatus.className = "status-badge valid";
  } catch (err) {
    currentComposition = null;
    jsonStatus.textContent = "Invalid JSON";
    jsonStatus.className = "status-badge invalid";
  }
  updatePreviewAspectRatio();
  updateMeta();
}

jsonEditor.addEventListener("input", onJsonChange);
jsonEditor.addEventListener("scroll", () => {
  editorHighlight.scrollTop = jsonEditor.scrollTop;
  editorHighlight.scrollLeft = jsonEditor.scrollLeft;
  editorGutterPre.style.transform = `translateY(${-jsonEditor.scrollTop}px)`;
});

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    renderBtn.click();
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") {
    e.preventDefault();
    formatJsonBtn.click();
  }
});

function loadPreset(key) {
  const data = presets[key] || Object.values(presets)[0];
  if (!data) return;
  jsonEditor.value = JSON.stringify(data, null, 2);
  onJsonChange();
}

async function fetchExamples() {
  try {
    const res = await fetch("/api/examples");
    const data = await res.json();
    if (data.success && data.examples && Object.keys(data.examples).length > 0) {
      presets = data.examples;
      presetSelect.innerHTML = "";
      for (const key of Object.keys(presets)) {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = `examples/${key}.json`;
        presetSelect.appendChild(option);
      }
      loadPreset(Object.keys(presets)[0]);
    }
  } catch (err) {
    console.error("Could not fetch server examples, using default preset:", err);
  }
}

presetSelect.addEventListener("change", (e) => {
  loadPreset(e.target.value);
});

encoderSelect.addEventListener("change", (e) => {
  rebuildSpeedSelect(e.target.value);
});

formatJsonBtn.addEventListener("click", () => {
  try {
    const parsed = JSON.parse(jsonEditor.value);
    jsonEditor.value = JSON.stringify(parsed, null, 2);
    onJsonChange();
  } catch (e) {
    // ignore format if invalid
  }
});

function setRenderState(rendering, message, className) {
  renderBtn.disabled = rendering;
  renderSpinner.classList.toggle("hidden", !rendering);
  renderBtnLabel.textContent = rendering ? "Rendering…" : "Render Video";
  if (message !== undefined) {
    renderStatusMsg.textContent = message;
    renderStatusMsg.className = "status-message" + (className ? ` ${className}` : "");
  }
}

renderBtn.addEventListener("click", async () => {
  if (!currentComposition) {
    setRenderState(false, "Fix JSON errors before rendering.", "error");
    return;
  }

  const selectedEncoder = encoderSelect ? encoderSelect.value : "auto";
  const selectedSpeed = speedSelect ? speedSelect.value : "veryfast";

  setRenderState(true, `Rendering with ${selectedEncoder}, ${selectedSpeed}…`, "rendering");

  try {
    const res = await fetch("/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ composition: currentComposition, encoder: selectedEncoder, preset: selectedSpeed })
    });

    const data = await res.json();

    if (data.success) {
      setRenderState(false, `Render completed · ${data.filename}`, "success");

      videoPlaceholder.classList.add("hidden");
      videoPlayer.classList.remove("hidden");
      videoPlayer.src = data.videoUrl;
      videoPlayer.load();
      videoPlayer.play().catch(() => {});

      downloadLink.href = data.videoUrl;
      downloadLink.classList.remove("hidden");
    } else {
      setRenderState(false, `Render failed: ${data.error}`, "error");
    }
  } catch (err) {
    setRenderState(false, `Render request error: ${err.message}`, "error");
  }
});

// Load examples dynamically from server
fetchExamples();
loadPreset("basic");
rebuildSpeedSelect(encoderSelect ? encoderSelect.value : "auto");
