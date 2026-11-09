# Scenes sized from narration

A scene can take its length from how long its speech actually lasts, instead of
a number guessed by hand.

```ts
import { composition, voice } from "@glitchoff/kino";

const line = await voice("The gate opens, and the world rewinds.");

const comp = composition({ width: 1920, height: 1080 })
  .scene({ duration: { fit: line } }, (s) => {
    s.say(line);
    s.text("Hacking to the Gate", { fontSize: 72, y: "center" });
  })
  .build();
```

## `voice()` is async on purpose

`await voice(text, opts)` synthesises **now** and returns a measured `Voice`
(`seconds`, `path`, `spec`). Because it is a promise, the duration is known
before the composition is built, so it can size a scene and be reused as a
variable. A render-time `tts()` could not do either.

## `duration: { fit, pad, lead, min }`

| Key | Default | Meaning |
| --- | --- | --- |
| `fit` | — | the `Voice` (or anything with `seconds`) to fit |
| `pad` | `0.6` | extra seconds after speech |
| `lead` | `0` | seconds of silence before speech |
| `min` | — | floor, if a short line should not make a short scene |

Fits are resolved during normalization, **before** validation, so the schema
only ever sees numbers — `{ fit }` never leaks into the validated shape.

## Reusing the audio

`s.say(line)` attaches the already-synthesised file. Do not call `voice()` again
for the same line: that re-synthesises and costs time (and gives slightly
different audio).

## Setup

Piper must be installed once:

```bash
npx kino setup tts
```

Voices and audio are cached globally, so repeated renders reuse them.

## Testing

`test/voice-duration.test.ts` covers the arithmetic and includes a real Piper
round-trip, skipped when Piper is absent. Verified end to end by rendering:
1.63 s of speech + 0.60 s pad = a 2.23 s scene.
