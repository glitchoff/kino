import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Local text-to-speech via Piper.
 *
 * Piper is **external and optional**, exactly like ffmpeg and yt-dlp: Kino
 * spawns the `piper` binary and never imports, bundles or links it. That
 * matters because Piper's engine is GPL-3.0 — a subprocess boundary keeps the
 * licence out of this package.
 *
 * ```ts
 * s.audio(tts("नमस्ते, welcome to Kino", { voice: "hi_IN-rohan" }));
 * ```
 *
 * Voices are downloaded lazily, one at a time (~64 MB each), into the asset
 * cache. Synthesis output is cached by text + voice, so a repeated line is
 * never re-synthesised.
 */

/** A Piper voice: an ONNX model plus its JSON config, served from Hugging Face. */
export interface VoiceSpec {
  /** Voice id, e.g. `hi_IN-rohan`. */
  id: string;
  /** BCP-47-ish language tag, e.g. `hi_IN`. */
  language: string;
  /** Human-readable language name. */
  languageName: string;
  /** Model quality tier. */
  quality: "low" | "medium" | "high";
}

const VOICE_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main";

/** Voices Kino knows about. Only these ids are accepted. */
export const KNOWN_VOICES: Readonly<Record<string, VoiceSpec>> = {
  "hi_IN-rohan": { id: "hi_IN-rohan", language: "hi_IN", languageName: "Hindi", quality: "medium" },
  "hi_IN-pratham": { id: "hi_IN-pratham", language: "hi_IN", languageName: "Hindi", quality: "medium" },
  "hi_IN-priyamvada": { id: "hi_IN-priyamvada", language: "hi_IN", languageName: "Hindi", quality: "medium" },
  "en_US-lessac-medium": {
    id: "en_US-lessac-medium",
    language: "en_US",
    languageName: "English (US)",
    quality: "medium",
  },
  "en_US-amy-medium": { id: "en_US-amy-medium", language: "en_US", languageName: "English (US)", quality: "medium" },
  "en_GB-alba-medium": { id: "en_GB-alba-medium", language: "en_GB", languageName: "English (GB)", quality: "medium" },
};

export const DEFAULT_VOICE = "en_US-lessac-medium";

/** Splits a voice id into its Hugging Face path: `hi/hi_IN/rohan/medium`. */
function voicePath(spec: VoiceSpec): string {
  const lang = spec.language.split("_")[0];
  const name = spec.id.slice(spec.language.length + 1).replace(new RegExp(`-${spec.quality}$`), "");
  return `${lang}/${spec.language}/${name}/${spec.quality}`;
}

/**
 * Full remote URL for a voice file.
 *
 * The directory drops the quality suffix (`.../lessac/medium/`) while the file
 * name carries it exactly once (`en_US-lessac-medium.onnx`). Some ids already
 * end in the quality (`hi_IN-rohan`), so it is only appended when missing.
 */
export function voiceUrl(spec: VoiceSpec, suffix: ".onnx" | ".onnx.json"): string {
  const file = spec.id.endsWith(`-${spec.quality}`) ? spec.id : `${spec.id}-${spec.quality}`;
  return `${VOICE_BASE}/${voicePath(spec)}/${file}${suffix}`;
}

/** Resolves a voice id, throwing a helpful error for unknown ones. */
export function resolveVoice(id: string = DEFAULT_VOICE): VoiceSpec {
  const spec = KNOWN_VOICES[id];
  if (!spec) {
    const available = Object.keys(KNOWN_VOICES).join(", ");
    throw new Error(`Unknown Piper voice '${id}'. Available voices: ${available}`);
  }
  return spec;
}

/** Default directory for downloaded voices. */
export function defaultVoiceDir(): string {
  return join(homedir(), ".cache", "kino", "tts", "voices");
}

/**
 * Default directory for synthesised audio.
 *
 * Global on purpose: the same line in the same voice is the same WAV, so a
 * shared cache means a second project reuses the first project's audio
 * instead of re-synthesising it.
 */
export function defaultTtsCacheDir(): string {
  return join(homedir(), ".cache", "kino", "tts", "audio");
}

/** True when a `piper` binary is on PATH. */
export function isPiperAvailable(): boolean {
  const res = spawnSync("piper", ["--help"], { encoding: "utf-8", timeout: 30_000 });
  return !res.error;
}

const INSTALL_HINT =
  "Piper is required for text-to-speech but was not found on PATH.\n" +
  "  Install it with: pip install piper-tts\n" +
  "  Then download a voice: npx kino setup tts";

export interface EnsureVoiceOptions {
  /** Where voices are stored. Defaults to `~/.cache/kino/tts/voices`. */
  voiceDir?: string;
  /** Fail instead of downloading. Used by `--dry-run`. */
  offline?: boolean;
}

/**
 * Ensures the voice's `.onnx` and `.onnx.json` exist locally, downloading
 * them if needed. Writes are temp-then-rename so an interrupted download
 * never leaves a truncated model behind.
 */
export async function ensureVoice(spec: VoiceSpec, options: EnsureVoiceOptions = {}): Promise<{ model: string; config: string }> {
  const dir = options.voiceDir ?? defaultVoiceDir();
  const model = join(dir, `${spec.id}.onnx`);
  const config = join(dir, `${spec.id}.onnx.json`);

  if (existsSync(model) && existsSync(config)) return { model, config };
  if (options.offline) {
    throw new Error(`Voice '${spec.id}' is not downloaded yet. Run \`npx kino setup tts\` first (or render once without --dry-run).`);
  }

  mkdirSync(dir, { recursive: true });

  for (const [local, suffix] of [
    [model, ".onnx"],
    [config, ".onnx.json"],
  ] as const) {
    if (existsSync(local)) continue;
    const url = voiceUrl(spec, suffix);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to download voice '${spec.id}' (${res.status} ${res.statusText}) from ${url}`);
    }
    const tmp = `${local}.part`;
    writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
    renameSync(tmp, local);
  }

  return { model, config };
}

export interface TtsOptions {
  /** Voice id. Defaults to `en_US-lessac-medium`. */
  voice?: string;
  /** Speaking rate multiplier; 1 is normal, 0.5 is half speed. */
  rate?: number;
  /** Where voices live. */
  voiceDir?: string;
  /** Where synthesised audio is cached. `false` disables the cache. */
  cacheDir?: string | false;
  /** Skip synthesis when a cached file exists. Defaults to true. */
  cache?: boolean;
}

/** Stable cache key: the same text in the same voice is the same audio. */
export function ttsCacheKey(text: string, spec: VoiceSpec, rate: number): string {
  return createHash("sha256").update(`piper:${spec.id}:${rate}:${text}`).digest("hex").slice(0, 32);
}

/**
 * Synthesises `text` to a WAV file and returns its absolute path.
 *
 * `piper` is spawned with the text on stdin; it must already be installed
 * (see {@link isPiperAvailable}).
 */
export async function synthesizeToWav(text: string, options: TtsOptions = {}): Promise<string> {
  const spec = resolveVoice(options.voice);
  const rate = options.rate ?? 1;
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`tts rate must be a positive number (got '${rate}').`);
  }

  const cacheDir = options.cacheDir === false ? undefined : (options.cacheDir ?? defaultTtsCacheDir());
  const key = ttsCacheKey(text, spec, rate);
  if (cacheDir) {
    const cached = join(cacheDir, `${key}.wav`);
    if (options.cache !== false && existsSync(cached)) return cached;
  }

  const { model, config } = await ensureVoice(spec, { voiceDir: options.voiceDir });

  const dir = cacheDir ?? join(defaultTtsCacheDir());
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${key}.wav`);

  const args = ["-m", model, "-c", config, "-f", out];
  // piper's --length-scale is the inverse of rate: faster speech is shorter.
  if (rate !== 1) args.push("--length-scale", String(1 / rate));

  const res = spawnSync("piper", args, {
    input: text,
    encoding: "utf-8",
    timeout: 300_000,
    maxBuffer: 16 * 1024 * 1024,
  });

  if (res.error) {
    if ((res.error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(INSTALL_HINT);
    throw res.error;
  }
  if (res.status !== 0 || !existsSync(out)) {
    // onnxruntime writes a benign PCI-bus warning to stderr on some hosts, so
    // surface stderr verbatim rather than trying to filter it.
    const detail = (res.stderr || "").trim().split("\n").slice(-3).join("\n");
    throw new Error(`piper exited with code ${res.status}.\n${detail}`);
  }

  return out;
}

export interface TtsSpec {
  /** Marker used by the composition builder and `compile()`. */
  readonly __kinoTts: true;
  text: string;
  options: TtsOptions;
}

/**
 * Declares synthesised speech as an audio source. Returns a marker object that
 * `compile()` resolves into a WAV before FFmpeg runs.
 *
 * ```ts
 * s.audio(tts("नमस्ते, welcome to Kino", { voice: "hi_IN-rohan" }));
 * ```
 */
export function tts(text: string, options: TtsOptions = {}): TtsSpec {
  if (!text.trim()) throw new Error("tts() needs non-empty text.");
  // Validate eagerly so a typo fails at build time, not render time.
  resolveVoice(options.voice);
  return { __kinoTts: true, text, options };
}

export function isTtsSpec(value: unknown): value is TtsSpec {
  return typeof value === "object" && value !== null && (value as TtsSpec).__kinoTts === true;
}

/** Human-readable summary used by `kino setup tts`. */
export function describeVoices(): string {
  return Object.values(KNOWN_VOICES)
    .map((v) => `  ${v.id.padEnd(24)} ${v.languageName} (${v.quality})`)
    .join("\n");
}

/** Copies a synthesised WAV into a staging dir so FFmpeg can read it relatively. */
export function stageTts(src: string, stagingDir: string): string {
  const name = src.slice(src.lastIndexOf("/") + 1);
  const dest = join(stagingDir, name);
  if (src !== dest) copyFileSync(src, dest);
  return name;
}

/** @internal Exposed for tests. */
export const voiceUrlForTests = voiceUrl;
