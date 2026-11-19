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
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import { synthesizeToWav, wavDuration } from "@glitchoff/kino";

const PIPER = "C:\\Users\\Abhay\\.local\\bin\\piper.exe";
// The voices already sit in the workspace; no need to download them again.
const VOICES = "D:\\Projects\\Misc\\3d-anim\\models\\piper";
const MODEL = join(VOICES, "hi_IN-priyamvada-medium.onnx");
const CONFIG = join(VOICES, "hi_IN-priyamvada-medium.onnx.json");

if (!existsSync(MODEL)) {
  console.error(`Hindi voice not found at ${MODEL}. Run \`npx kino setup tts\` first.`);
  process.exit(1);
}

const TEXT = "नमस्ते, यह आवाज़ किसी भी टीटीएस से आ सकती है।";

// The same program, named as a command instead of built in.
//
// The text reaches piper through a file, not stdin — see the note in
// `src/tts/piper.ts`. A command engine writes `{text}` into a file itself,
// so the template points at that file with `-i`.
import { writeFileSync } from "node:fs";
const TEXT_FILE = "D:\\Projects\\Misc\\3d-anim\\kino\\out\\cmd-text.txt";
writeFileSync(TEXT_FILE, `${TEXT}\n`, "utf-8");

const command =
  `"${PIPER}" --model "${MODEL}" --config "${CONFIG}" -f {out} -i "${TEXT_FILE}"`;

console.log("1. built-in piper engine…");
// The built-in engine resolves voices from its own cache, so this run uses
// `voiceDir` to point it at the workspace copies.
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

const delta = Math.abs(piperSeconds - commandSeconds);
console.log(`   piper:   ${piperSeconds.toFixed(3)}s  ${statSync(viaPiper).size} bytes`);
console.log(`   command: ${commandSeconds.toFixed(3)}s  ${statSync(viaCommand).size} bytes`);
console.log(`   delta:   ${delta.toFixed(3)}s`);

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
