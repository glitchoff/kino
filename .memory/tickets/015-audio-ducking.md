# 015 — Audio ducking

**Status:** done (2026-11-08) — `duck` on `AudioTrack`, resolved in `resolveDucking()` and rendered by `buildAudioMix()`. `duck: true` listens to speech tracks; `duck: { by, amount, attack, release, threshold }` is explicit.
**Created:** 2026-11-08

## Problem

Narration over music is the most common composition there is, and kino cannot
express it.

`buildAudioMix` in `src/pipeline/audio.ts` supports `volume`, `fadeIn`,
`fadeOut`, `offset`, `duration` and `startTime` per track, then `amix`es them.
Nothing can make one track respond to another. To put music under a voice track
today you hand-key every volume change — and there is no way to know when the
narration actually speaks without listening to the render.

## Proposed

A per-track `duck` option naming the tracks that should push it down:

```ts
composition()
  .audio({ src: "./music.mp3", volume: 0.6, duck: { by: ["voice"], amount: 0.3 } })
  .audio({ src: "./voice.wav", id: "voice" });
```

`by` is one or more track ids (so tracks need ids, which they do not have yet).
`amount` is how far to attenuate while the other track is active — `0.3` means
music drops to 30% of its volume, not by 30%.

## How

`sidechaincompress` is the right filter, not manual volume automation:

```
[music][voice]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400[music_ducked]
```

- It follows the actual speech envelope, so it does not need word timings.
- `attack`/`release` are the musical controls: a long release is what stops it
  pumping between sentences.
- It is one filter, not N `volume` expressions.

Tracks with a `duck` entry have to be mixed *after* their sidechain sources
exist, so `buildAudioMix` needs a dependency order rather than its current flat
loop. The graph is small and acyclic — ducking a track that ducks another is the
only cycle to reject, and validation should catch it.

## Open questions

- **Do tracks get `id`s?** `duck.by` needs to name them. Adding `id` is small
  but it is a schema change.
- ~~Is `sidechaincompress` in the vendored ffmpeg?~~ **Yes** — verified
  2026-11-08 against `vendor/linux/x64/ffmpeg`.
- **Should there be a shorthand?** `duck: true` meaning "duck under every track
  that has speech" would cover 90% of uses. Worth having alongside the explicit
  form.
- **Does narration get tagged automatically?** `s.say()` / `tts()` tracks could
  be marked as speech at normalization, so `duck: true` knows what to listen to.

## Related

- `buildAudioMix` is the only place that touches audio filters; this stays
  contained there.
- Ticket 016 (keyframes) would let ducking be overridden manually where the
  automatic version gets it wrong.
