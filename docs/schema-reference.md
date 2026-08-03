# JSON Schema Reference

The `KinoComposition` JSON object defines canvas properties, frame rate, global audio tracks, and mandatory `scenes[]`.

---

## 🎬 Core Mental Model

> **Composition contains Scenes.**  
> **Scenes play sequentially and own time/backgrounds.**  
> **Elements are layers inside Scenes.**  
> **Elements start at `startAt` seconds relative to their parent Scene.**

---

## Canvas & Composition Properties

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `width` | `number` | `1920` | Output video canvas width in pixels. |
| `height` | `number` | `1080` | Output video canvas height in pixels. |
| `fps` | `number` | `30` | Frame rate in FPS. |
| `scenes` | `KinoScene[]` | **Required** | Array of scene objects. Must contain at least 1 scene. |
| `audio` | `AudioTrack \| AudioTrack[]` | `[]` | Background music / audio track configurations. |

---

## Scene Configuration (`KinoScene`)

Scenes play sequentially back-to-back automatically.

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | `scene-1`, ... | Optional unique identifier for the scene. |
| `duration` | `number` | **Required** | Duration of the scene in seconds. |
| `transition` | `KinoTransition` | undefined | Optional transition into this scene from the previous scene (cannot be set on the first scene). |
| `background` | `BackgroundInput` | `"#000000"` | Solid color hex string or background config object. |
| `elements` | `ElementInput[]` | `[]` | Array of visual elements (`text`, `image`, `video`) inside the scene. |

---

## Scene Transitions (`KinoTransition`)

Transitions belong to the **entering** scene (Scene 2 transitions INTO the composition over Scene 1). The first scene in a composition cannot define a transition.

```json
{
  "duration": 5,
  "background": "#312e81",
  "transition": {
    "type": "slideLeft",
    "duration": 0.6
  }
}
```

### Supported Transition Types (`KinoTransitionType`)
- `fade`
- `slideLeft`, `slideRight`, `slideUp`, `slideDown`
- `wipeLeft`, `wipeRight`, `wipeUp`, `wipeDown`
- `zoomIn`, `zoomOut`

Transitions operate on fully composited scenes (including background, text, images, and animations) and overlap adjacent scenes. Total composition duration equals `sum(scene.duration) - sum(transition.duration)`.

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

> Note: `startAt` on an element is **relative to its parent scene's start time**.

### 1. `TextElement` (`type: "text"`)

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | undefined | Optional identifier for the element. |
| `type` | `"text"` | `"text"` | Element type discriminator. |
| `content` | `string` | `""` | Text string to render. |
| `fontSize` | `number` | `48` | Font size in pixels. |
| `fontColor` | `string` | `"white"` | Text color. |
| `fontFile` | `string` | `Inter Regular (bundled)` | Custom font file path or `http(s)` URL. When omitted, Kino's bundled **Inter Regular** font is embedded in the `.kino` artifact and used for rendering (ensures consistent output across all platforms). Local paths are copied into the archive; remote font URLs are downloaded at compile time. |
| `box` | `boolean` | `false` | Enable background box behind text. |
| `boxColor` | `string` | `"black@0.5"` | Background box color with opacity. |
| `boxPadding` | `number` | `10` | Border padding around text box. |
| `maxWidth` | `number` | undefined | Target maximum width in pixels for automatic line wrapping. Preserves hard newlines (`\n`) and never splits unbreakable tokens. (Approximate measurement in V1 zero-dependency mode). |
| `textAlign` | `"left" \| "center" \| "right"` | `"left"` | Alignment of text lines inside the text box. |
| `lineHeight` | `number` | `1` | Multiplier for line height spacing (`1` = normal, `1.5` = 50% extra line spacing). |
| `stroke` | `{ color: string; width: number }` | undefined | Text outline stroke color and border width. |
| `shadow` | `{ color: string; x?: number; y?: number }` | undefined | Text drop shadow color and x/y pixel offsets (defaults to `x: 2, y: 2`). |
| `x` | `number \| string` | `"center"` | Horizontal position (`"center"`, expression, or number). Position applies to the overall text region. |
| `y` | `number \| string` | `"center"` | Vertical position (`"center"`, `"top-N"` / `"bottom-N"`, expression, or number). |
| `startAt` | `number` | `0` | Delay in seconds relative to scene start time. |
| `duration` | `number` | Scene duration | Visible duration in seconds. |
| `sfx` | `string \| AudioTrack` | undefined | Sound effect triggered when element appears. |
| `zIndex` | `number` | declaration index | Layering order. Lower values render first (background), higher values render on top. Negative values clamp to `0`. When omitted, elements stack in declaration order. Applied composition-globally across all scenes. |
| `animation` | `ElementAnimation` | undefined | Per-element animations (opacity / x / y / scale). See **Animation Reference**. |

### 2. `ImageElement` (`type: "image"`)

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | undefined | Optional identifier for the element. |
| `type` | `"image"` | required | Element type discriminator. |
| `src` | `string` | required | File path or `http(s)` URL to image file. Remote URLs are downloaded into the `.kino` artifact at compile time. |
| `width` | `number` | original | Target width in pixels. |
| `height` | `number` | original | Target height in pixels. |
| `fit` | `MediaFit` | undefined | Aspect-ratio fit when both `width` and `height` are set (see **Shared Media Fit**). When unset: native dimensions if `width`/`height` are omitted, force-scale to `width`×`height` if both are set. |
| `x` | `number \| string` | `"center"` | Horizontal position. |
| `y` | `number \| string` | `"center"` | Vertical position (`"center"`, expression, or number). |
| `startAt` | `number` | `0` | Delay in seconds relative to scene start time. |
| `duration` | `number` | Scene duration | Visible duration in seconds. |
| `sfx` | `string \| AudioTrack` | undefined | Sound effect triggered when element appears. |
| `zIndex` | `number` | declaration index | Layering order. Lower values render first (background), higher values render on top. Negative values clamp to `0`. When omitted, elements stack in declaration order. Applied composition-globally across all scenes. |
| `animation` | `ElementAnimation` | undefined | Per-element animations (opacity / x / y / scale). See **Animation Reference**. |

### 3. `VideoElement` (`type: "video"`)

A positional video clip overlaid inside a scene. Supports source seeking, duration clipping, optional looping, optional audio extraction (opt-in via `volume`), shared `fit` layout, and the same per-element animations as `ImageElement`.

By default a `VideoElement` is **silent** (`volume: 0`); its audio is excluded unless `volume` is set to a positive value, at which point it is folded into Kino's shared `amix` master alongside background tracks and element SFX.

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | undefined | Optional identifier for the element. |
| `type` | `"video"` | required | Element type discriminator. |
| `src` | `string` | required | File path or `http(s)` URL to a video file. Remote URLs are downloaded into the `.kino` artifact at compile time. |
| `width` | `number` | original | Target width in pixels. |
| `height` | `number` | original | Target height in pixels. |
| `fit` | `MediaFit` | `"contain"` | Aspect-ratio fit when both `width` and `height` are set (see **Shared Media Fit**). |
| `x` | `number \| string` | `"center"` | Horizontal position (`"center"`, expression, or number). |
| `y` | `number \| string` | `"center"` | Vertical position (`"center"`, expression, or number). |
| `startAt` | `number` | `0` | Delay in seconds relative to scene start time. |
| `duration` | `number` | Scene duration | Visible duration in seconds. This is also the length of source footage consumed. |
| `trimStart` | `number` | `0` | Seek offset in seconds into the source file for playback (source segment = `trimStart` → `trimStart + duration`). |
| `loop` | `boolean` | `false` | Loop the source to fill `duration` when the footage is shorter. If `false` and the remaining source (after `trimStart`) is shorter than `duration`, the clip is clipped at the source end. |
| `volume` | `number` | `0` | Source audio gain. `0` (default) **silences** element audio (no audio stream is emitted). Set to a positive value (e.g. `1`) to opt the source audio into the shared `amix` master. |
| `sfx` | `string \| AudioTrack` | undefined | Sound effect triggered when element appears. |
| `zIndex` | `number` | declaration index | Layering order (see `ImageElement`). |
| `animation` | `ElementAnimation` | undefined | Per-element animations (opacity / x / y / scale). See **Animation Reference**. |

#### Semantics

```
scene t=4s                         (startAt)
   ↓ video element appears
source playback begins at t=12s   (trimStart)
   ↓
plays for 6 seconds               (duration)
   ↓
source segment = 12s → 18s        (trimStart → trimStart + duration)
```

##### Shared Media Fit (`MediaFit`)

`fit` is shared between `ImageElement.fit` and `VideoElement.fit` and only applies when **both** `width` and `height` are specified:

| Value | Behavior |
| :--- | :--- |
| `"contain"` (default for video) | Scale to fit entirely inside the box, preserving aspect ratio; pad the remainder with transparency (`0x00000000`). |
| `"cover"` | Scale to fully cover the box, preserving aspect ratio; crop overflow. |
| `"fill"` | Force-scale to the exact `width` × `height`, ignoring aspect ratio. |
| `"none"` | No `fit`-driven scaling. When both `width` and `height` are set, the media is still scaled to that exact box (`scale=w:h`); otherwise native dimensions are kept. |

---

## Animation Reference (`ElementAnimation`)

Every `TextElement`, `ImageElement`, and `VideoElement` may define an `animation` object with up to four channels: `opacity`, `x`, `y`, and `scale`. Each channel is an `AnimationValue`:

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `from` | `number` | **required** | Starting value. For `opacity`, `0`–`1`; for `scale`, multiplier (`1` = 100%); for `x`/`y`, pixels of translation offset on top of the element's static position. |
| `to` | `number` | **required** | Ending value. |
| `duration` | `number` | **required** | Duration of the transition in seconds. |
| `delay` | `number` | `0` | Delay in seconds before the animation begins (per channel). |
| `easing` | `Easing` | `"linear"` | Timing curve: `"linear"`, `"easeIn"`, `"easeOut"`, or `"easeInOut"`. |

`Easing` curves: `linear` = `p`, `easeIn` = `p³`, `easeOut` = `1-(1-p)³`, `easeInOut` = `3p²-2p³`.

### Behavior

- **Element-local clock.** An animation begins at `scene.startTime + element.startAt + delay`, independent of other channels.
- **Hold → Interpolate → Hold.** The value equals `from` before the window, interpolates during `[start, start+duration]`, and holds `to` afterward.
- **Clip, never rescale.** If `delay + duration` exceeds the element's own lifetime, the animation is clipped at the element boundary; it never rescales the layer or affects other elements.
- **Static positioning is preserved.** `x`/`y` are translation offsets layered on top of the element's static `x`/`y` layout (static layout is never overridden). `scale` is a center-anchored multiplier — `1` = natural size; `to:0` collapses to zero size.
- **Opacity** is a `0`–`1` alpha multiplier applied via the alpha channel.

### Example

```json
{
  "type": "text",
  "content": "Hello, Kino",
  "x": "center",
  "y": "(h-text_h)/2",
  "startAt": 0,
  "duration": 6,
  "animation": {
    "opacity": { "from": 0, "to": 1, "duration": 1, "easing": "easeOut" },
    "x":      { "from": -400, "to": 0, "duration": 1.2, "delay": 0.2, "easing": "easeInOut" },
    "scale":  { "from": 0.2, "to": 1, "duration": 1, "easing": "easeOut" }
  }
}
```

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
