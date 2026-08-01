# JSON Schema Reference

The `KinoComposition` JSON object defines canvas properties, duration, background types, FPS, polymorphic scene element timelines, and audio/SFX mixing.

---

## Normalization Layer

Kino accepts clean shorthand syntax and normalizes it internally:

- `"background": "#0f172a"`  
  ↓ *normalizes to*  
  `"background": { "type": "color", "value": "#0f172a" }`

- `"elements": [{ "content": "Text" }]`  
  ↓ *normalizes to*  
  `"elements": [{ "type": "text", "content": "Text" }]`

---

## Canvas & Composition Properties

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `width` | `number` | `1920` | Output video canvas width in pixels. |
| `height` | `number` | `1080` | Output video canvas height in pixels. |
| `duration` | `number` | `5` | Total video duration in seconds. |
| `background` | `BackgroundInput` | `"#000000"` | Hex string shorthand or background object (Color, Image, Gradient, Video). |
| `fps` | `number` | `30` | Frame rate in FPS. |
| `elements` | `ElementInput[]` | `[]` | Polymorphic elements array (`text`, `image`). |
| `audio` | `AudioTrack \| AudioTrack[]` | `[]` | Background music / audio track configurations. |

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

## Polymorphic Elements

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
| `x` | `number \| string` | `"center"` | Horizontal position (expression or number). |
| `y` | `number \| string` | `"center"` | Vertical position (expression or number). |
| `startTime` | `number` | `0` | Delay in seconds before text appears. |
| `duration` | `number` | Video duration | Visible duration in seconds. |
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
| `startTime` | `number` | `0` | Start time in seconds. |
| `duration` | `number` | Video duration | Duration in seconds. |
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
| `loop` | `boolean` | `false` | Loop audio throughout scene duration. |
| `fadeIn` | `number` | `0` | Fade-in duration in seconds. |
| `fadeOut` | `number` | `0` | Fade-out duration in seconds. |
