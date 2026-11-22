# Rule: resolve by id, never by array position

**Added 2026-11-22 by Ghost (paper-ghost).** This is a rule, not a changelog.

## The rule

When one list is indexed against another, and the second list can gain entries
from somewhere else, **do not use the index**. Resolve by a stable key.

The bug this rule comes from:

```ts
// src/normalize/audio.ts, resolveDucking(), before the fix
raw.forEach((track, i) => {
  const target = tracks[i];   // tracks has grown; raw has not
```

`raw` is `comp.audio` — what the author declared. `tracks` is that list **plus**
every `s.say()` narration track, appended earlier in
`normalizeComposition()`. The indexes agree only while nothing has been appended
ahead of them.

## What it broke

Ducking was unusable, and the two errors pointed at the wrong cause:

| Call | Error | What it suggested |
| --- | --- | --- |
| `duck: { by: "voice" }` | "ducks under 'voice', which does not exist" | a missing track id |
| `duck: true` | "has duck: true but there is no speech to duck under" | no narration in the composition |

Both were wrong. Narration **was** there, and the ids **were** valid. The lookup
was reading the wrong element, so it found a narration track (no id, not speech)
where it expected the music bed, and never saw the speech tracks it was told to
listen for.

The second message is the tell: it claims there is no speech while the caller has
just added 104 lines of it.

## The fix

```ts
const byId = new Map<string, NormalizedAudioTrack>();
for (const t of tracks) if (t.id) byId.set(t.id, t);

raw.forEach((track) => {
  const target = track.id ? byId.get(track.id) : undefined;
  if (!target) return;
```

`byId` was already being built three lines above and was only used for
validation. It is now the lookup.

## Where to look for the same shape

Any `forEach((x, i) => other[i])` where `other` is built by something other than
a map over the same input. In this codebase, watch `normalizeComposition()`
specifically — it assembles `audioTracks` from three sources (declared tracks,
scene narration, scene sfx) before resolving anything against it.

## Verifying it

The failure was silent in the sense that mattered: a composition with `duck: true`
either threw or rendered with the bed at full level. Both look like "ducking is
just not supported" from outside.

**Check by profiling the whole clip, not by sampling one window.** Sampling
0.2–0.8 s of a test render showed 0.9 dB and looked like a failure; walking the
file in 0.25 s steps showed a peak of **4.0 dB** at the points where speech
actually falls. The ducking is short and follows the speech envelope, so a
single window can easily land between events. `profile_duck.py` in the kino root
does the walk.

A correct result looks like: attenuation that rises and falls with the speech,
peaking around 2–4 dB at `amount: 0.05`, and roughly proportional to `amount`
below that.

## Still open: the depth is gentler than the calibration predicts

`duckGain()` is calibrated against a sine bed and a sine voice, and its own
comment says "the exact figure depends on programme material — this is a target,
not a guarantee". On real music under real speech the measured duck is about
4 dB at `amount: 0.05`, where the sine calibration implies more.

This is **tuning, not correctness**. Ducking works; it is subtle. Do not
"fix" it by raising the default `amount` without listening — the right depth is
a judgement about the programme, and the current default (0.3) is deliberately
mild.

