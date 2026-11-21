// Voice showcase for the Kaguya chapter: every engine, every voice, any line,
// rendered on demand.
//
//   npx tsx showcase.ts
//   → http://localhost:4100
//
// Engines are named here, not in kino: kino's `command` engine runs whatever
// program the template names, so the list of voices is the composition's
// business. Adding a voice means adding it to the array below.
//
// Saved lines and shortlisted voices persist in .kino/showcase/ beside this
// file, so a restart keeps the shortlist.
import { pathToFileURL } from "node:url";

const { serveShowcase } = await import(pathToFileURL("D:/Projects/Misc/kino/dist/index.js").href);

const PG = "D:/Projects/Misc/paper-ghost";
const KOKORO_PY = `${PG}/.venv/Scripts/python.exe`;
const KOKORO = `${PG}/kino-kokoro.py`;
const POCKET_PY = `${PG}/.venv-pocket/Scripts/python.exe`;
const POCKET = `${PG}/kino-pocket.py`;

// The 27 Pocket voices, read from the installed model rather than typed, so
// this file cannot drift from what the engine actually ships.
import { execFileSync } from "node:child_process";
const pocketVoices = execFileSync(
  POCKET_PY,
  ["-c", "from pocket_tts.utils.utils import _ORIGINS_OF_PREDEFINED_VOICES as V; print('\\n'.join(sorted(V)))"],
  { encoding: "utf-8" }
)
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean);

// Kokoro's voices: the four the channel picked, plus a few alternates worth
// hearing against them.
const kokoroVoices = [
  "af_bella", "af_nova", "af_sky", "am_michael",
  "af_heart", "af_sarah", "af_nicole", "am_adam", "am_onyx", "bf_emma",
];

// The chapter's own lines — these are what the audition should use, not
// invented test sentences.
const presets = [
  "So cuuu-uute! Kyaa-aaah!",
  "That's the president's desk! You hear me? Hey!",
  "Get out of here!",
  "I'm warning you!",
  "Shoo! Shoo!",
  "Ha. I can finally relax.",
  "What!?",
  "Time to work.",
  "Fujiwara says she's team dogs. And Kaguya thinks she's a cat-hater. Kaguya, who hates cats, meets a cat.",
];

await serveShowcase({
  engines: [
    {
      id: "pocket",
      label: "Pocket TTS",
      voices: pocketVoices,
      options: {
        engine: "command",
        command: `${POCKET_PY} ${POCKET} --voice {voice} --text {text} --out {out}`,
      },
    },
    {
      id: "kokoro",
      label: "Kokoro",
      voices: kokoroVoices,
      options: {
        engine: "command",
        command: `${KOKORO_PY} ${KOKORO} --voice {voice} --text {text} --out {out}`,
      },
    },
  ],
  presets,
  dataDir: "D:/Projects/Misc/kino/.kino/showcase",
});
