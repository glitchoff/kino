# Sound

Narration is measured, so a scene can be sized to a line of speech. Music can
duck under it. Both survive a restart: timings and generated audio are cached on
disk, not held in memory.

## Narration

Speech is generated locally with [Piper](https://github.com/OHF-Voice/piper1-gpl).
Piper is **external and optional** — kino spawns the `piper` binary and never
bundles it (its engine is GPL-3.0; the subprocess boundary keeps that out of
this package).

```bash
# one-time, outside the project
pip install piper-tts
```

```typescript
// Per scene: the scene can size itself to the speech.
.scene({ duration: { fit: await voice("Already measured") } }, (s) => {
  s.say("Already measured");
})

// Or measure first and place the scene yourself.
s.say("नमस्ते, welcome to Kino", { voice: "hi_IN-rohan" });
```

`voice()` synthesises once and returns a handle, so a line can be measured and
reused without synthesising twice.

## Music and ducking

```typescript
composition().audio([
  { src: "./music.mp3", id: "music", volume: 0.6, loop: true, duck: true },
  { src: "./voice.wav", id: "voice" },
]);
```

`duck: true` lowers the music whenever a speech track — anything from `tts()` or
`s.say()` — is audible. Name tracks explicitly to control it:

```typescript
{ src: "./music.mp3", id: "music", duck: { by: "voice", amount: 0.25 } }
```

| `DuckConfig` | Default | Description |
| --- | --- | --- |
| `by` | every speech track | Track id, or an array of them |
| `amount` | `0.3` | Level to drop **to**, so `0.3` means 30% |
| `release` | `0.4` | Seconds to ramp back up. Longer stops it pumping |
| `attack` | `0.02` | Seconds to ramp down |
| `threshold` | `0.02` | Sidechain level that counts as speech |

It follows the real speech envelope, so it needs no word timings. `amount` is a
target, not a guarantee — the achieved depth depends on how loud the speech is.

| Audio track field | Description |
| --- | --- |
| `src` | File, URL, `yt:` source, or `tts()` spec |
| `id` | Names the track so another can duck under it |
| `startTime` / `offset` / `duration` | Position and trim |
| `volume` / `loop` / `fadeIn` / `fadeOut` | Level and shape |
| `duck` | Drop under speech |

---
---

Next: [Checking your work](./checking.md) covers seeing the result before you
render it.
