/**
 * "क्यों?" — a curiosity-loop explainer short.
 *
 * One format, every episode:
 *   1. HOOK      a question that cannot be scrolled past
 *   2. MECHANISM how it actually works, one idea per beat
 *   3. PAYOFF    a fact the viewer can retell
 *
 * 1080x1920, ~55-65s, Hindi narration through Kokoro's `command` engine.
 *
 *   npx tsx examples/why.ts
 *   npx tsx examples/why.ts --preview     # 360p, fast, for checking layout
 *
 * Narration defaults to Piper, which needs only the `piper` binary on PATH
 * (`pip install piper-tts`). To use a local Kokoro install instead, set
 * KINO_KOKORO_DIR to the folder holding `.venv-kokoro` and `kokoro-tts.py`.
 *
 * The narration text reaches Kokoro through a file, never an argument:
 * PowerShell mangles Devanagari on the command line.
 */
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ellipse,
  fadeIn,
  merge,
  rect,
  render,
  scene,
  text,
  tts,
  voice,
  type TtsOptions,
} from "@glitchoff/kino";

// ---------------------------------------------------------------------------
// Narration engine
// ---------------------------------------------------------------------------
//
// Defaults to Piper: it is a single binary on PATH, and CI installs it
// (`pip install piper-tts`) precisely so the TTS examples run there. Point at a
// local Kokoro instead with KINO_KOKORO_DIR — the venv and kokoro-tts.py are in
// the paper-ghost workspace, not in this repo.
//
// The point of the example is the `command` engine, so it keeps showing how a
// model Kino does not know about plugs in; Piper is only the default so the
// file works on a machine that has nothing but kino.

const WORKSPACE = process.env.KINO_KOKORO_DIR ?? "";
const PYTHON =
  process.platform === "win32"
    ? join(WORKSPACE, ".venv-kokoro", "Scripts", "python.exe")
    : join(WORKSPACE, ".venv-kokoro", "bin", "python");
const SCRIPT = join(WORKSPACE, "kokoro-tts.py");
const VOICE_ID = "hf_alpha";

/** True when a local Kokoro install is present. */
const KOKORO_READY = WORKSPACE !== "" && existsSync(PYTHON) && existsSync(SCRIPT);

/** A `tts()` spec that runs Kokoro, with the text passed through a file. */
function kokoro(line: string, rate = 1): TtsOptions {
  const key = createHash("sha1").update(line).digest("hex").slice(0, 16);
  const file = join(tmpdir(), `kino-kokoro-${key}.txt`);
  writeFileSync(file, `${line}\n`, "utf-8");

  return {
    engine: "command",
    voice: VOICE_ID,
    rate,
    command:
      `"${PYTHON}" "${SCRIPT}" --text-file "${file}" ` +
      `--out {out} --voice {voice} --rate {rate}`,
  };
}

/** Synthesises a line now and returns its measured length. */
const say = (line: string) =>
  KOKORO_READY ? voice(line, kokoro(line)) : voice(line, { engine: "piper", voice: "en_US-lessac-medium" });


// ---------------------------------------------------------------------------
// Look
// ---------------------------------------------------------------------------

const W = 1080;
const H = 1920;

const NIGHT = "#080c16";
const INK = "#f1f5f9";
const DIM = "#94a3b8";
const CYAN = "#22d3ee";
const AMBER = "#fbbf24";
const RED = "#ef4444";

const DEV = "C:\\Windows\\Fonts\\Nirmala.ttc";

// ---------------------------------------------------------------------------
// The script — one episode, three acts
// ---------------------------------------------------------------------------

const LINES = {
  // HOOK — the question, plus the reason you cannot leave.
  hook: "आसमान नीला क्यों दिखता है? इसका जवाब आपके फेफड़ों से जुड़ा है।",
  hook2: "यह जानने के बाद आप आसमान को कभी वैसे नहीं देख पाएँगे।",

  // MECHANISM — one idea per beat.
  beat1: "सूरज की रोशनी सफ़ेद दिखती है। लेकिन असल में उसमें सात रंग छिपे हैं।",
  beat2: "जब यह रोशनी हवा के अणुओं से टकराती है, तो नीला रंग सबसे ज़्यादा बिखरता है।",
  beat3: "छोटी तरंगें बड़ी तरंगों से ज़्यादा बिखरती हैं। नीली रोशनी की तरंग सबसे छोटी है।",
  beat4: "इसीलिए आसमान नीला है, और सूरज डूबते समय लाल।",

  // PAYOFF — the fact worth repeating.
  payoff: "अब असली बात। अगर हवा न होती, तो आसमान बिल्कुल काला होता।",
  payoff2: "चाँद पर आसमान काला इसीलिए है। वहाँ हवा ही नहीं है।",
  outro: "दोस्त को बताइए, आसमान का नीला रंग हवा की वजह से है।",
};

const L = {
  hook: await say(LINES.hook),
  hook2: await say(LINES.hook2),
  beat1: await say(LINES.beat1),
  beat2: await say(LINES.beat2),
  beat3: await say(LINES.beat3),
  beat4: await say(LINES.beat4),
  payoff: await say(LINES.payoff),
  payoff2: await say(LINES.payoff2),
  outro: await say(LINES.outro),
};

const total = Object.values(L).reduce((sum, v) => sum + v.seconds, 0);
console.log(
  Object.entries(L)
    .map(([k, v]) => `  ${k.padEnd(8)} ${v.seconds.toFixed(2)}s`)
    .join("\n")
);
console.log(`  narration ${total.toFixed(2)}s`);

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** The channel mark: a dot and the wordmark, constant across episodes. */
function mark(y: number) {
  return [
    ellipse({ width: 16, height: 16, x: W / 2 - 74, y: y + 8, fill: CYAN }),
    text("क्यों?", {
      fontSize: 38,
      color: DIM,
      fontFile: DEV,
      x: W / 2 - 46,
      y: y + 36,
    }),
  ];
}

/** One big statement, centred. */
function statement(line: string, y: string, opts: { size?: number; color?: string; at?: number } = {}) {
  return text(line, {
    fontSize: opts.size ?? 78,
    color: opts.color ?? INK,
    fontFile: DEV,
    x: "center",
    y,
    startAt: opts.at ?? 0,
    animation: fadeIn(0.4),
  });
}

/** A labelled colour bar, for the seven-colours beat. */
function bar(x: number, fill: string, at: number) {
  return rect({
    width: 78,
    height: 150,
    x,
    y: 800,
    fill,
    radius: 6,
    startAt: at,
    animation: fadeIn(0.25),
  });
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

/**
 * Attaches a measured line to a scene.
 *
 * `scene()` has no `say()` of its own — that belongs to the builder — so the
 * spec is spread onto the scene, which is what `s.say()` produces anyway.
 * Without this the voice is synthesised and then never used, and the render
 * comes out silent.
 */
function withSpeech<T extends object>(s: T, spoken: Awaited<ReturnType<typeof say>>): T {
  return { ...s, narration: [spoken.spec] };
}

const video = {
  width: W,
  height: H,
  fps: 30,
  ...merge(
    // HOOK
    withSpeech(scene({ id: "hook", for: { fit: L.hook, pad: 1.0 }, bg: NIGHT }, [
      ...mark(190),
      statement("आसमान", "center-320", { size: 128 }),
      statement("नीला क्यों?", "center-180", { size: 128, color: CYAN, at: 0.35 }),
      rect({ width: 420, height: 8, x: W / 2 - 210, y: 1010, fill: CYAN, startAt: 0.9, animation: fadeIn(0.4) }),
      statement("जवाब आपके फेफड़ों से जुड़ा है", "center+90", { size: 48, color: DIM, at: 1.2 }),
    ]), L.hook),

    // HOOK 2 — the promise.
    withSpeech(scene({ id: "hook2", for: { fit: L.hook2, pad: 0.9 }, bg: NIGHT, transition: { type: "fade", duration: 0.4 } }, [
      ...mark(190),
      statement("इसके बाद", "center-140", { size: 84, color: DIM }),
      statement("आसमान वैसा नहीं दिखेगा", "center", { size: 84, at: 0.4 }),
    ]), L.hook2),

    // MECHANISM 1 — white light holds seven colours.
    withSpeech(scene({ id: "beat1", for: { fit: L.beat1, pad: 0.8 }, bg: NIGHT, transition: { type: "fade", duration: 0.4 } }, [
      ...mark(190),
      statement("सफ़ेद रोशनी", "center-320", { size: 84 }),
      rect({ width: 640, height: 110, x: W / 2 - 320, y: 780, fill: "#ffffff", radius: 8, startAt: 0.4, animation: fadeIn(0.4) }),
      bar(190, "#ef4444", 1.0),
      bar(300, "#f97316", 1.1),
      bar(410, "#facc15", 1.2),
      bar(520, "#22c55e", 1.3),
      bar(630, "#3b82f6", 1.4),
      bar(740, "#6366f1", 1.5),
      bar(850, "#a855f7", 1.6),
      statement("7 रंग", "center+130", { size: 62, color: AMBER, at: 1.8 }),
    ]), L.beat1),

    // MECHANISM 2 — scattering.
    withSpeech(scene({ id: "beat2", for: { fit: L.beat2, pad: 0.8 }, bg: NIGHT, transition: { type: "fade", duration: 0.4 } }, [
      ...mark(190),
      statement("नीला रंग", "center-280", { size: 96, color: CYAN }),
      statement("सबसे ज़्यादा बिखरता है", "center-170", { size: 72, at: 0.4 }),
      ellipse({ width: 190, height: 190, x: W / 2 - 95, y: 900, fill: AMBER, startAt: 0.8, animation: fadeIn(0.4) }),
      text("सूरज", { fontSize: 42, color: NIGHT, fontFile: DEV, x: "center", y: 1008, startAt: 0.8, animation: fadeIn(0.3) }),
    ]), L.beat2),

    // MECHANISM 3 — short waves scatter more.
    withSpeech(scene({ id: "beat3", for: { fit: L.beat3, pad: 0.8 }, bg: NIGHT, transition: { type: "fade", duration: 0.4 } }, [
      ...mark(190),
      text("छोटी तरंग", { fontSize: 62, color: CYAN, fontFile: DEV, x: 170, y: "center-160", textAlign: "left", animation: fadeIn(0.35) }),
      text("ज़्यादा बिखरती है", { fontSize: 62, color: INK, fontFile: DEV, x: 170, y: "center-70", textAlign: "left", startAt: 0.3, animation: fadeIn(0.35) }),
      text("बड़ी तरंग", { fontSize: 62, color: AMBER, fontFile: DEV, x: 170, y: "center+130", textAlign: "left", startAt: 0.6, animation: fadeIn(0.35) }),
      text("कम बिखरती है", { fontSize: 62, color: INK, fontFile: DEV, x: 170, y: "center+220", textAlign: "left", startAt: 0.9, animation: fadeIn(0.35) }),
    ]), L.beat3),

    // MECHANISM 4 — blue sky, red sunset.
    withSpeech(scene({ id: "beat4", for: { fit: L.beat4, pad: 0.8 }, bg: NIGHT, transition: { type: "fade", duration: 0.4 } }, [
      ...mark(190),
      statement("दिन में", "center-260", { size: 54, color: DIM }),
      statement("नीला", "center-160", { size: 110, color: CYAN, at: 0.3 }),
      statement("शाम को", "center+60", { size: 54, color: DIM, at: 0.7 }),
      statement("लाल", "center+160", { size: 110, color: RED, at: 1.0 }),
    ]), L.beat4),

    // PAYOFF — the twist.
    withSpeech(scene({ id: "payoff", for: { fit: L.payoff, pad: 0.9 }, bg: "#12080a", transition: { type: "fade", duration: 0.5 } }, [
      ...mark(190),
      statement("हवा न होती", "center-240", { size: 70, color: DIM }),
      statement("तो आसमान", "center-110", { size: 88, at: 0.4 }),
      statement("काला होता", "center+70", { size: 130, color: RED, at: 0.8 }),
    ]), L.payoff),

    // PAYOFF 2 — the moon proves it.
    withSpeech(scene({ id: "payoff2", for: { fit: L.payoff2, pad: 0.9 }, bg: "#05070d", transition: { type: "fade", duration: 0.4 } }, [
      ...mark(190),
      ellipse({ width: 260, height: 260, x: W / 2 - 130, y: 720, fill: "#e2e8f0", startAt: 0.2, animation: fadeIn(0.5) }),
      statement("चाँद पर आसमान काला है", "center+150", { size: 66, at: 0.8 }),
      statement("वहाँ हवा ही नहीं", "center+260", { size: 66, color: CYAN, at: 1.4 }),
    ]), L.payoff2),

    // OUTRO — the line to repeat.
    withSpeech(scene({ id: "outro", for: { fit: L.outro, pad: 1.2 }, bg: NIGHT, transition: { type: "fade", duration: 0.4 } }, [
      ...mark(190),
      statement("आसमान का नीला रंग", "center-140", { size: 64 }),
      statement("हवा की वजह से है", "center-20", { size: 64, color: CYAN, at: 0.4 }),
      rect({ width: 200, height: 6, x: W / 2 - 100, y: 1120, fill: CYAN, startAt: 1.0, animation: fadeIn(0.4) }),
      statement("क्यों?", "center+240", { size: 48, color: DIM, at: 1.2 }),
    ]), L.outro)
  ),
};

export default video;

// Render when run directly.
if (import.meta.main && !process.argv.includes("--dry-run")) {
  const preview = process.argv.includes("--preview");
  await render(video, {
    output: preview ? "out/why-preview.mp4" : "out/why.mp4",
    ...(preview ? { preview: 360 } : {}),
  });
}
