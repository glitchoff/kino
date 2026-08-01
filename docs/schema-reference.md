# JSON Schema Reference

The `KinoComposition` JSON object defines canvas properties, frame rate, optional timeline mode (`"sequential"` or `"absolute"`), global audio tracks, and mandatory `scenes[]`.

---

## 🎬 Core Mental Model

> **Composition contains Scenes.**  
> **Scenes own time and backgrounds.**  
> **Elements are layers inside Scenes.**  
> **Elements never float directly in the Composition.**

---

## Canvas & Composition Properties

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `width` | `number` | `1920` | Output video canvas width in pixels. |
| `height` | `number` | `1080` | Output video canvas height in pixels. |
| `fps` | `number` | `30` | Frame rate in FPS. |
| `timeline` | `"sequential" \| "absolute"` | `"sequential"` | Timeline calculation mode for scenes. |
| `scenes` | `KinoScene[]` | **Required** | Array of scene objects. Must contain at least 1 scene. |
| `audio` | `AudioTrack \| AudioTrack[]` | `[]` | Background music / audio track configurations. |

---

## Timeline Modes (`timeline`)

### 1. `sequential` (Default)
Scenes play back-to-back automatically.
- Scene 1 start time = `0`
- Scene 2 start time = `Scene 1.duration`
- Scene 3 start time = `Scene 1.duration + Scene 2.duration`

### 2. `absolute`
Scenes specify their own `startTime`.
- Each scene provides an explicit `startTime: number` (defaults to `0` if omitted).
- Scenes can overlap or play concurrently.

---

## Scene Configuration (`KinoScene`)

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | `scene-1`, ... | Optional unique identifier for the scene. |
| `duration` | `number` | **Required** | Duration of the scene in seconds. |
| `startTime` | `number` | `0` | Start time offset (Only used in `timeline: "absolute"` mode). |
| `background` | `BackgroundInput` | `"#000000"` | Solid color hex string or background config object. |
| `elements` | `ElementInput[]` | `[]` | Array of visual elements (`text`, `image`) inside the scene. |

---

## Background Configurations

### 1. Solid Color
`"background": "#0f172a"` or `"background": { "type": "color", "value": "#0f172a" }`

### 2. Gradient
`"background": { "type": "gradient", "from": "#0f172a", "to": "#7c3aed" }`

### 3. Image Fill
`"background": { "type": "image", "src": "./bg.jpg" }`

### 4. Video Loop
`"background": { "type": "video", "src": "./loop.mp4", "loop": true }`

---

## Elements (`ElementInput`)

> Note: `startTime` on an element is **relative to its parent scene's start time**.

### 1. `TextElement` (`type: "text"`)

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `type` | `"text"` | `"text"` | Element type discriminator. |
| `content` | `string` | `""` | Text string to render. |
| `fontSize` | `number` | `48` | Font size in pixels. |
| `fontColor` | `string` | `"white"` | Text color. |
| `box` | `boolean` | `false` | Enable background box behind text. |
| `boxColor` | `string` | `"black@0.5"` | Background box color with opacity. |
| `boxPadding` | `number` | `10` | Border padding around text box. |
| `x` | `number \| string` | `"center"` | Horizontal position (`"center"`, expression, or number). |
| `y` | `number \| string` | `"center"` | Vertical position (`"center"`, `"bottom-20"`, expression, or number). |
| `startTime` | `number` | `0` | Delay in seconds relative to scene start time. |
| `duration` | `number` | Scene duration | Visible duration in seconds. |
| `sfx` | `string \| AudioTrack` | undefined | Sound effect triggered when element appears. |

### 2. `ImageElement` (`type: "image"`)

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `type` | `"image"` | required | Element type discriminator. |
| `src` | `string` | required | File path or URL to image file. |
| `width` | `number` | original | Target width in pixels. |
| `height` | `number` | original | Target height in pixels. |
| `x` | `number \| string` | `"center"` | Horizontal position. |
| `y` | `number \| string` | `"center"` | Vertical position. |
| `startTime` | `number` | `0` | Delay in seconds relative to scene start time. |
| `duration` | `number` | Scene duration | Visible duration in seconds. |
| `sfx` | `string \| AudioTrack` | undefined | Sound effect triggered when element appears. |

---

## Audio Tracks & SFX (`AudioTrack`)

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `src` | `string` | required | File path or URL to audio file (`.mp3`, `.wav`, `.aac`). |
| `startTime` | `number` | `0` | Timeline delay start offset in seconds. |
| `offset` | `number` | `0` | Seek start offset within source audio file in seconds. |
| `duration` | `number` | audio duration | Playback clip duration in seconds. |
| `volume` | `number` | `1.0` | Volume multiplier (`0.3` = 30%, `1.5` = 150%). |
| `loop` | `boolean` | `false` | Loop audio throughout duration. |
| `fadeIn` | `number` | `0` | Fade-in duration in seconds. |
| `fadeOut` | `number` | `0` | Fade-out duration in seconds. |
