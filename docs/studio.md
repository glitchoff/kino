# Kino Studio Guide

**Kino Studio** is a browser-based playground for Kino compositions.

---

## 🎨 Launching Kino Studio

Start the local studio server using `pnpm studio`:

```bash
pnpm studio

# Or specify custom port
npx kino studio --port 3333
```

Navigate to `http://localhost:3333` in your web browser.

---

## 🌟 Features

1. **GPU Encoder Selection**:
   - Select hardware acceleration directly from the top navigation toolbar:
     - `⚡ Auto (GPU / CPU Fallback)`
     - `🚀 NVIDIA GPU (h264_nvenc / hevc_nvenc)`
     - `💻 CPU (libx264)`
     - `⚡ Apple VideoToolbox (macOS)`
     - `⚡ Intel QSV / AMD AMF`

2. **Speed & Quality Presets**:
   - Choose encoder performance profiles:
     - `⚡ Very Fast (Recommended)`
     - `🚀 Ultra Fast (Max Speed)`
     - `⚖️ Balanced (Medium)`
     - `💎 High Quality (Slow)`

3. **Live JSON Editor**:
   - Syntax validation status badge ("Valid JSON" / "Invalid JSON").
   - Pre-loaded composition presets (Mobile 9:16, Landscape 16:9, Multi-scene demo).
   - "Format JSON" action button.

4. **Live FFmpeg Command Inspector**:
   - Re-compiles FFmpeg command line arguments in real-time as you edit JSON.
   - "Copy Command" button for easy terminal execution.

5. **Render & Check Engine**:
   - "Render Video & Check" button sends JSON composition to Hono backend server (`/api/render`).
   - Plays rendered output video directly inside the browser player with a one-click download button.
