const presets = {
  basic: {
    width: 1080,
    height: 1920,
    duration: 5,
    background: "#000000",
    fps: 30,
    text: [
      {
        content: "Hello Kino",
        fontSize: 72,
        fontColor: "white",
        x: "center",
        y: "center",
        startTime: 0,
        duration: 3
      },
      {
        content: "JSON to FFmpeg",
        fontSize: 48,
        fontColor: "#38bdf8",
        x: "center",
        y: "(h-text_h)/2+120",
        startTime: 2,
        duration: 3
      }
    ]
  },
  timeline: {
    width: 1920,
    height: 1080,
    duration: 8,
    background: "#0f172a",
    fps: 30,
    text: [
      {
        content: "Scene 1: Introduction",
        fontSize: 64,
        fontColor: "#f8fafc",
        x: "center",
        y: "center",
        startTime: 0,
        duration: 4
      },
      {
        content: "Scene 2: Compiled with FFmpeg",
        fontSize: 56,
        fontColor: "#34d399",
        x: "center",
        y: "center",
        startTime: 4,
        duration: 4
      }
    ]
  },
  minimal: {
    width: 1080,
    height: 1080,
    duration: 4,
    background: "#1e1b4b",
    fps: 30,
    text: [
      {
        content: "Minimal Square Video",
        fontSize: 54,
        fontColor: "#a78bfa",
        x: "center",
        y: "center",
        startTime: 0,
        duration: 4
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
  const data = presets[key] || presets.basic;
  jsonEditor.value = JSON.stringify(data, null, 2);
  onJsonChange();
}

async function updateFFmpegCompilePreview() {
  if (!currentComposition) return;
  try {
    const res = await fetch("/api/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(currentComposition)
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

function onJsonChange() {
  try {
    const parsed = JSON.parse(jsonEditor.value);
    currentComposition = parsed;
    jsonStatus.textContent = "Valid JSON";
    jsonStatus.className = "status-badge valid";
    
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
  renderStatusMsg.textContent = "Compiling & rendering with FFmpeg...";
  renderStatusMsg.className = "status-message";

  try {
    const res = await fetch("/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(currentComposition)
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

// Initialize with default preset
loadPreset("basic");
