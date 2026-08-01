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
const ffmpegCmdOutput = document.getElementById("ffmpeg-cmd-output");
const presetSelect = document.getElementById("preset-select");
const formatJsonBtn = document.getElementById("format-json-btn");
const copyCmdBtn = document.getElementById("copy-cmd-btn");
const renderBtn = document.getElementById("render-btn");
const renderSpinner = document.getElementById("render-spinner");
const renderStatusMsg = document.getElementById("render-status-msg");
const videoPlayer = document.getElementById("video-player");
const videoPlaceholder = document.getElementById("video-placeholder");
const downloadLink = document.getElementById("download-link");

let currentComposition = null;
let updateDebounceTimeout = null;

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

const encoderSelect = document.getElementById("encoder-select");
const speedSelect = document.getElementById("speed-select");

async function updateFFmpegCompilePreview() {
  if (!currentComposition) return;
  try {
    const encoder = encoderSelect ? encoderSelect.value : "auto";
    const preset = speedSelect ? speedSelect.value : "veryfast";
    const res = await fetch("/api/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ composition: currentComposition, encoder, preset })
    });
    const data = await res.json();
    if (data.success) {
      ffmpegCmdOutput.textContent = data.command;
    } else {
      ffmpegCmdOutput.textContent = `Error compiling: ${data.error}`;
    }
  } catch (err) {
    ffmpegCmdOutput.textContent = `Error connecting to studio server: ${err.message}`;
  }
}

const videoWrapper = document.querySelector(".video-wrapper");

function updatePreviewAspectRatio() {
  if (currentComposition && currentComposition.width && currentComposition.height) {
    const w = currentComposition.width;
    const h = currentComposition.height;
    videoWrapper.style.aspectRatio = `${w} / ${h}`;
  } else {
    videoWrapper.style.aspectRatio = "16 / 9";
  }
}

function onJsonChange() {
  try {
    const parsed = JSON.parse(jsonEditor.value);
    currentComposition = parsed;
    jsonStatus.textContent = "Valid JSON";
    jsonStatus.className = "status-badge valid";
    
    updatePreviewAspectRatio();
    clearTimeout(updateDebounceTimeout);
    updateDebounceTimeout = setTimeout(updateFFmpegCompilePreview, 250);
  } catch (err) {
    currentComposition = null;
    jsonStatus.textContent = "Invalid JSON";
    jsonStatus.className = "status-badge invalid";
    ffmpegCmdOutput.textContent = `JSON Syntax Error: ${err.message}`;
  }
}

jsonEditor.addEventListener("input", onJsonChange);

if (encoderSelect) {
  encoderSelect.addEventListener("change", onJsonChange);
}
if (speedSelect) {
  speedSelect.addEventListener("change", onJsonChange);
}

presetSelect.addEventListener("change", (e) => {
  loadPreset(e.target.value);
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

copyCmdBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(ffmpegCmdOutput.textContent);
  const origText = copyCmdBtn.textContent;
  copyCmdBtn.textContent = "Copied!";
  setTimeout(() => {
    copyCmdBtn.textContent = origText;
  }, 1500);
});

renderBtn.addEventListener("click", async () => {
  if (!currentComposition) {
    alert("Please fix JSON syntax errors before rendering.");
    return;
  }

  renderBtn.disabled = true;
  renderSpinner.classList.remove("hidden");
  const selectedEncoder = encoderSelect ? encoderSelect.value : "auto";
  const selectedSpeed = speedSelect ? speedSelect.value : "veryfast";
  renderStatusMsg.textContent = `Rendering with FFmpeg (${selectedEncoder}, ${selectedSpeed})...`;
  renderStatusMsg.className = "status-message";

  try {
    const res = await fetch("/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ composition: currentComposition, encoder: selectedEncoder, preset: selectedSpeed })
    });

    const data = await res.json();

    if (data.success) {
      renderStatusMsg.textContent = `Render completed successfully! (${data.filename})`;
      renderStatusMsg.className = "status-message success";

      videoPlaceholder.classList.add("hidden");
      videoPlayer.classList.remove("hidden");
      videoPlayer.src = data.videoUrl;
      videoPlayer.load();
      videoPlayer.play().catch(() => {});

      downloadLink.href = data.videoUrl;
      downloadLink.classList.remove("hidden");
    } else {
      renderStatusMsg.textContent = `Render failed: ${data.error}`;
      renderStatusMsg.className = "status-message error";
    }
  } catch (err) {
    renderStatusMsg.textContent = `Render request error: ${err.message}`;
    renderStatusMsg.className = "status-message error";
  } finally {
    renderBtn.disabled = false;
    renderSpinner.classList.add("hidden");
  }
});

// Load examples dynamically from server
fetchExamples();
loadPreset("basic");
