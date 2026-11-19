import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";

/**
 * The `command` engine: any external text-to-speech binary.
 *
 * Kino spawns the program and never imports it, for the same reasons Piper is
 * spawned — a model's weights and licence stay outside this package. That is
 * what makes *any* TTS usable: if a program can be run from a shell and write
 * a WAV, it works here.
 *
 * ```ts
 * tts("नमस्ते", {
 *   engine: "command",
 *   voice: "dhvaani",
 *   command: "python dhvaani-tts.py --text {text} --out {out}",
 * })
 * ```
 *
 * `{text}` and `{out}` are replaced literally. `{text}` is quoted for the
 * platform, so text containing spaces, quotes or Devanagari is passed as one
 * argument. `{rate}` is the speaking rate multiplier.
 */

/** Substitutions available in a command template. */
export interface CommandContext {
  text: string;
  out: string;
  rate: number;
  voice: string;
  /** Absolute path of the reference clip, for cloning engines. */
  reference?: string;
  /** Transcript of the reference clip. */
  referenceText?: string;
}

/**
 * Quotes one argument for `spawnSync`.
 *
 * The program is spawned directly, never through a shell, so the Windows rule
 * is the MSVCRT/`CommandLineToArgvW` one — backslash-escape an embedded quote —
 * not cmd.exe's double-the-quote rule. Using the cmd.exe rule here leaves a
 * literal backslash in the argument.
 */
export function quoteArg(value: string): string {
  if (process.platform === "win32") {
    // Backslashes are only special immediately before a quote: double them
    // there, and escape the quote itself.
    const escaped = value.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\+)$/, "$1$1");
    return `"${escaped}"`;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Expands a command template into an argument vector.
 *
 * The template is split on whitespace *before* substitution so a quoted or
 * spaced path in the program itself survives, and substituted values are
 * always quoted — never interpolated raw, which is what makes a transcript
 * containing a quote or `&` safe to pass.
 */
export function buildCommandArgs(template: string, context: CommandContext): string[] {
  const values: Record<string, string> = {
    text: quoteArg(context.text),
    out: quoteArg(context.out),
    rate: String(context.rate),
    voice: quoteArg(context.voice),
    reference: context.reference ? quoteArg(context.reference) : "",
    referenceText: context.referenceText ? quoteArg(context.referenceText) : "",
  };

  return template
    .match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)!
    .map((token) => token.replace(/\{(text|out|rate|voice|referenceText|reference)\}/g, (_, key: string) => values[key]!))
    .map(unquoteIfNeeded);
}

/** Strips one layer of quoting a template author wrote around a token. */
function unquoteIfNeeded(token: string): string {
  if (token.length >= 2) {
    const first = token[0];
    const last = token[token.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return token.slice(1, -1);
    }
  }
  return token;
}

export interface CommandEngineOptions {
  /** Template, e.g. `piper-tts --text {text} --out {out}`. */
  command: string;
  /** Voice id passed to `{voice}`; also part of the cache key. */
  voice?: string;
  /** Reference clip for zero-shot cloning engines. */
  reference?: string;
  /** Transcript of `reference`. */
  referenceText?: string;
  /** Seconds allowed before the process is killed. */
  timeoutMs?: number;
}

export interface CommandEngineResult {
  /** Absolute path of the WAV written by the program. */
  path: string;
  /** The argv actually spawned, for error messages and `--dry-run`. */
  argv: string[];
}

/** Stable cache key across engines: two engines must not share a file. */
export function commandCacheKey(text: string, options: CommandEngineOptions, rate: number): string {
  return createHash("sha256")
    .update(`command:${options.command}:${options.voice ?? ""}:${options.reference ?? ""}:${rate}:${text}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Runs a `command` engine for one line of speech.
 *
 * The output path is chosen here and passed in, so a program that honours
 * `{out}` needs no knowledge of the cache. A program that prints a path
 * instead is not supported on purpose: two conventions is one too many.
 */
export function synthesizeWithCommand(
  text: string,
  options: CommandEngineOptions,
  cacheDir: string,
  rate = 1
): CommandEngineResult {
  const key = commandCacheKey(text, options, rate);
  const out = join(cacheDir, `${key}.wav`);
  const argv = buildCommandArgs(options.command, {
    text,
    out,
    rate,
    voice: options.voice ?? "",
    reference: options.reference,
    referenceText: options.referenceText,
  });

  if (existsSync(out)) return { path: out, argv };

  mkdirSync(cacheDir, { recursive: true });
  // Write beside the destination so a killed process never leaves a
  // half-written file that the next run treats as cached.
  const part = `${out}.part.wav`;
  const withPart = argv.map((arg) => (arg === out ? part : arg));

  const program = withPart[0]!;
  const res = spawnSync(program, withPart.slice(1), {
    encoding: "utf-8",
    timeout: options.timeoutMs ?? 600_000,
    maxBuffer: 16 * 1024 * 1024,
  });

  if (res.error) {
    if ((res.error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `TTS command not found: '${program}'.\n` +
          `  The 'command' engine runs whatever program the template names.\n` +
          `  Check it is on PATH, or use an absolute path in the template.`
      );
    }
    throw res.error;
  }
  if (res.status !== 0) {
    const detail = (res.stderr || res.stdout || "").trim().split("\n").slice(-4).join("\n");
    throw new Error(`TTS command exited with code ${res.status}.\n  ${argv.join(" ")}\n${detail}`);
  }
  if (!existsSync(part)) {
    throw new Error(
      `TTS command exited cleanly but wrote no file at '${part}'.\n` +
        `  The template must write to {out} — e.g. ... --out {out}`
    );
  }

  renameSync(part, out);
  return { path: out, argv };
}

/** Reads a command template from a file, for long or multi-line templates. */
export function commandFromFile(file: string): string {
  return readFileSync(file, "utf-8").trim();
}
