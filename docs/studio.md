# Kino Studio Guide

**Kino Studio** is a browser-based playground for Kino compositions.

---

## 🎨 Launching Kino Studio

### Development Mode (Vite HMR + Hono API)
```bash
# Terminal 1: Launch Hono Backend
pnpm studio

# Terminal 2: Launch Vite Dev Server
pnpm studio:dev
```
Navigate to `http://localhost:5173`.

### Production Server
```bash
pnpm studio:build
pnpm studio
```
Navigate to `http://localhost:3333`.

---

## 🌟 Features

1. **Monaco JSON Editor with Inline Diagnostics**:
   - Built-in JSON editor powered by `@monaco-editor/react`.
   - Real-time schema validation diagnostics highlighting invalid properties with **inline squiggly red error markers**.

2. **Tabbed Validation View**:
   - Tab 1 (`JSON Code`): IDE-grade JSON composition editor with format action (`Ctrl/Cmd+Shift+F`).
   - Tab 2 (`Validation`): Full-panel view listing path-indexed schema issues (`scenes[2].elements[4].width`) with glowing issue counter badges (`Validation (3)`) and "Copy Issues" action.

3. **GPU Encoder Selection**:
   - Select hardware acceleration directly from the top navigation toolbar:
     - `Auto (GPU / CPU Fallback)`
     - `NVIDIA GPU (h264_nvenc / hevc_nvenc)`
     - `CPU (libx264)`
     - `Apple VideoToolbox (macOS)`
     - `Intel QSV / AMD AMF`

4. **Speed & Quality Presets**:
   - Choose encoder performance profiles: `Very Fast`, `Ultra Fast`, `Balanced`, `High Quality`.

5. **Render & Check Engine**:
   - "Render Video & Check" button sends JSON composition to Hono backend server (`/api/render`).
   - Plays rendered output video directly inside the browser player with a one-click download button.
