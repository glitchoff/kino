# JSON Schema Reference

The `KinoComposition` JSON object defines canvas properties, video duration, background colors, frame rates, and scene element timelines.

---

## `KinoComposition` Properties

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `width` | `number` | `1920` | Output video canvas width in pixels. |
| `height` | `number` | `1080` | Output video canvas height in pixels. |
| `duration` | `number` | `5` | Total video duration in seconds. |
| `background` | `string` | `"#000000"` | Canvas background color (Hex `#RRGGBB` or color name like `"black"`, `"blue"`). |
| `fps` | `number` | `30` | Frame rate (frames per second). |
| `text` | `TextOverlay \| TextOverlay[]` | `[]` | Text overlays to render on the timeline. |
| `elements` | `TextOverlay[]` | `[]` | Array alias for scene elements. |

---

## `TextOverlay` Properties

Each text element object defines text content, font styling, screen positioning, and active time windows.

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `content` | `string` | `""` (required) | Text string to draw on screen. |
| `fontSize` | `number` | `48` | Font size in pixels. |
| `fontColor` | `string` | `"white"` | Text color (Hex format or color name). |
| `x` | `number \| string` | `"center"` | Horizontal position. `"center"` maps to `(w-text_w)/2`. FFmpeg expressions allowed (e.g. `100`, `(w-text_w)/2`). |
| `y` | `number \| string` | `"center"` | Vertical position. `"center"` maps to `(h-text_h)/2`. FFmpeg expressions allowed (e.g. `(h-text_h)/2+100`). |
| `startTime` | `number` | `0` | Delay in seconds before text appears on screen. |
| `duration` | `number` | Total video duration | Duration in seconds the text remains visible. |
| `fontFile` | `string` | System font | Path to custom `.ttf` or `.otf` font file. |

---

## 💡 Examples

### 1. Vertical Video (1080x1920)

```json
{
  "width": 1080,
  "height": 1920,
  "duration": 5,
  "background": "#000000",
  "fps": 30,
  "text": [
    {
      "content": "Short Form Video",
      "fontSize": 72,
      "fontColor": "#38bdf8",
      "x": "center",
      "y": "center"
    }
  ]
}
```

### 2. Multi-Text Timeline

```json
{
  "width": 1920,
  "height": 1080,
  "duration": 6,
  "background": "#0f172a",
  "text": [
    {
      "content": "First 3 Seconds",
      "fontSize": 60,
      "fontColor": "#ffffff",
      "startTime": 0,
      "duration": 3
    },
    {
      "content": "Last 3 Seconds",
      "fontSize": 60,
      "fontColor": "#34d399",
      "startTime": 3,
      "duration": 3
    }
  ]
}
```
