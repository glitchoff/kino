# Kino Studio Guide

**Kino Studio** is a browser-based playground for Kino compositions.

---

## 🎨 Launching Kino Studio

Start the local studio server using `pnpm studio` (runs with automatic file watching via `tsx watch`):

```bash
pnpm studio
```

Navigate to `http://localhost:3333` in your web browser.

---

## 🌟 Features

1. **Live JSON Editor**:
   - Syntax validation status badge ("Valid JSON" / "Invalid JSON").
   - Pre-loaded presets dropdown (Vertical 1080x1920, Landscape 1920x1080, Minimal Square).
   - "Format JSON" action button.

2. **Live FFmpeg Command Inspector**:
   - Re-compiles FFmpeg command line arguments in real-time as you edit JSON.
   - "Copy Command" button for easy terminal execution.

3. **Render & Check Engine**:
   - "Render Video & Check" button sends JSON composition to Hono backend server (`/api/render`).
   - Generates `.mp4` video files.
   - Plays rendered output video directly inside the browser player with a one-click download button.
