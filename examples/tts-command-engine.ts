/**
 * The `command` engine, end to end.
 *
 * Synthesises the same Hindi line twice — once through the built-in Piper
 * engine, once through `engine: "command"` driving the *same* Piper binary —
 * and checks the two WAVs are the same length. That proves the command engine
 * produces real, playable audio through the seam `synthesizeToWav()` and not
 * just a file with the right name.
 *
 *   npx tsx examples/tts-command-engine.ts
 *
 * Requires Piper and the Hindi voice. The command engine is how any other TTS
 * (DhVaani, edge-tts, a local script) plugs in: point `command` at a program
 * that takes `--text` and writes `--out`.
 */
import { existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

import { composition, synthesizeToWav, wavDuration } from "@glitchoff/kino";

/**
 * Where the voice lives.
 *
 * Overridable, because a hardcoded `D:\Projects\Misc\...` path only exists on
 * one machine — CI has no such directory, so the examples dry run failed there.
 * Defaults to Piper's own voice cache, which is where `npx kino setup tts`
 * puts it, so a fresh clone works once the voice is installed.
 */
const VOICES = process.env.KINO_PIPER_VOICES ?? join(homedir(), ".local", "share", "piper-voices");
const MODEL = join(VOICES, "hi_IN-priyamvada-medium.onnx");
const CONFIG = join(VOICES, "hi_IN-priyamvada-medium.onnx.json");

// Piper itself: `piper` on PATH is the portable default. The old
// `C:\Users\Abhay\.local\bin\piper.exe` made this file Windows-only.
const PIPER = process.env.PIPER_BIN ?? "piper";

const TEXT = "नमस्ते, यह आवाज़ किसी भी टीटीएस से आ सकती है।";

/**
 * Checks the command engine against the built-in Piper engine.
 *
 * Runs only when executed directly. `--dry-run` imports this file to compile
 * it, and synthesis must not happen then — every other example guards this
 * way, and this one did not.
 */
async function verify(): Promise<void> {
  if (!existsSync(MODEL)) {
    console.error(`Hindi voice not found at ${MODEL}. Run \`npx kino setup tts\` first.`);
    process.exit(1);
  }

  // The text reaches piper through a file, not stdin — see the note in
  // `src/tts/piper.ts`. A command engine writes `{text}` into a file itself,
  // so the template points at that file with `-i`.
  const TEXT_FILE = join(tmpdir(), "kino-cmd-text.txt");
  writeFileSync(TEXT_FILE, `${TEXT}\n`, "utf-8");

  const command =
    `"${PIPER}" --model "${MODEL}" --config "${CONFIG}" -f {out} -i "${TEXT_FILE}"`;

  console.log("1. built-in piper engine…");
  const viaPiper = await synthesizeToWav(TEXT, {
    voice: "hi_IN-priyamvada",
    voiceDir: VOICES,
    cacheDir: false,
  });
  const piperSeconds = wavDuration(viaPiper);

  console.log("2. command engine, same binary…");
  const viaCommand = await synthesizeToWav(TEXT, {
    engine: "command",
    voice: "hi_IN-priyamvada",
    command,
    cacheDir: false,
  });
  const commandSeconds = wavDuration(viaCommand);

  if (piperSeconds === undefined || commandSeconds === undefined) {
    console.error("one of the outputs is not a readable WAV");
    process.exit(1);
  }

  console.log(`   piper:   ${piperSeconds.toFixed(3)}s  ${statSync(viaPiper).size} bytes`);
  console.log(`   command: ${commandSeconds.toFixed(3)}s  ${statSync(viaCommand).size} bytes`);

  // Piper is non-deterministic — its noise scales vary per run — so two runs of
  // the same line differ by a few hundred ms. What must hold is that both
  // engines produced substantial, playable speech, not that they match exactly.
  const MIN_SECONDS = 1;
  if (piperSeconds < MIN_SECONDS || commandSeconds < MIN_SECONDS) {
    console.error(`FAIL: expected at least ${MIN_SECONDS}s of speech from both engines`);
    process.exit(1);
  }
  const ratio = Math.max(piperSeconds, commandSeconds) / Math.min(piperSeconds, commandSeconds);
  if (ratio > 1.25) {
    console.error(`FAIL: lengths differ by more than 25% (${ratio.toFixed(2)}x)`);
    process.exit(1);
  }
  console.log("OK — the command engine produced real speech through the same seam.");
}

// A composition, like every other example, so `--dry-run` can compile it.
// The check above runs on `--verify` instead of at import time.
const comp = composition({ width: 1080, height: 1920, fps: 30 }).scene(
  { duration: 3, background: "#0b1020" },
  (s) => {
    s.text("command engine", {
      fontSize: 64,
      fontColor: "#ffffff",
      x: "center",
      y: "center",
    });
  }
);

export default comp.build();

if (import.meta.main && process.argv.includes("--verify")) {
  await verify();
}
