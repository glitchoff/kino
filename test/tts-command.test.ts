import { describe, test, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCommandArgs, quoteArg, commandCacheKey, synthesizeWithCommand } from "../src/tts/command.js";
import { tts, synthesizeToWav } from "../src/tts/piper.js";

const ctx = (over: Partial<Parameters<typeof buildCommandArgs>[1]> = {}) => ({
  text: "नमस्ते",
  out: "/tmp/a.wav",
  rate: 1,
  voice: "dhvaani",
  ...over,
});

describe("command engine: template", () => {
  test("substitutes text, out, rate and voice", () => {
    const argv = buildCommandArgs("tts --text {text} --out {out} --rate {rate} --voice {voice}", ctx());
    expect(argv[0]).toBe("tts");
    expect(argv).toContain("--text");
    expect(argv[argv.indexOf("--text") + 1]).toBe("नमस्ते");
    expect(argv[argv.indexOf("--out") + 1]).toBe("/tmp/a.wav");
    expect(argv[argv.indexOf("--rate") + 1]).toBe("1");
    expect(argv[argv.indexOf("--voice") + 1]).toBe("dhvaani");
  });

  test("quoted values arrive as one argument, not several", () => {
    const argv = buildCommandArgs("tts --text {text} --out {out}", ctx({ text: "a b c" }));
    expect(argv[argv.indexOf("--text") + 1]).toBe("a b c");
  });

  test("text with a quote or ampersand survives as one argument", () => {
    const argv = buildCommandArgs("tts --text {text} --out {out}", ctx({ text: `he said "hi" & left` }));
    // The template splits on whitespace, so a value with spaces is held
    // together by the quoting — check the joined form keeps it as one token.
    const joined = argv.slice(argv.indexOf("--text") + 1, argv.indexOf("--out")).join(" ");
    expect(joined.replace(/\\/g, "")).toBe(`he said "hi" & left`);
  });

  test("reference and referenceText are exposed for cloning engines", () => {
    const argv = buildCommandArgs(
      "clone --ref {reference} --ref-text {referenceText} --text {text} --out {out}",
      ctx({ reference: "/tmp/ref.wav", referenceText: "sample words" })
    );
    expect(argv[argv.indexOf("--ref") + 1]).toBe("/tmp/ref.wav");
    expect(argv[argv.indexOf("--ref-text") + 1]).toBe("sample words");
  });

  test("a quoted path in the template is unquoted into the argv", () => {
    const argv = buildCommandArgs(`"C:/Program Files/tts.exe" --text {text} --out {out}`, ctx());
    expect(argv[0]).toBe("C:/Program Files/tts.exe");
  });

  test("quoteArg escapes an embedded quote", () => {
    const q = quoteArg(`a"b`);
    // The rule is platform-specific: Windows uses MSVCRT backslash-escaping
    // inside double quotes, POSIX uses single quotes (where `"` needs no
    // escaping at all). Asserting `"` on both platforms only passed on Windows.
    if (process.platform === "win32") {
      expect(q.startsWith('"')).toBe(true);
      expect(q.endsWith('"')).toBe(true);
      expect(q).not.toBe('"a"b"');
    } else {
      expect(q.startsWith("'")).toBe(true);
      expect(q.endsWith("'")).toBe(true);
      // Single quotes neutralise a double quote without escaping it.
      expect(q).toBe(`'a"b'`);
    }
  });
});

describe("command engine: cache key", () => {
  test("same text and template share a key", () => {
    const o = { command: "tts {text} {out}", voice: "x" };
    expect(commandCacheKey("hi", o, 1)).toBe(commandCacheKey("hi", o, 1));
  });

  test("a different template is a different key", () => {
    expect(commandCacheKey("hi", { command: "a {text} {out}" }, 1)).not.toBe(
      commandCacheKey("hi", { command: "b {text} {out}" }, 1)
    );
  });

  test("a different voice is a different key", () => {
    const command = "tts {text} {out}";
    expect(commandCacheKey("hi", { command, voice: "a" }, 1)).not.toBe(
      commandCacheKey("hi", { command, voice: "b" }, 1)
    );
  });

  test("a different rate is a different key", () => {
    const o = { command: "tts {text} {out}" };
    expect(commandCacheKey("hi", o, 1)).not.toBe(commandCacheKey("hi", o, 0.5));
  });
});

describe("command engine: synthesis", () => {
  test("runs the program and returns the file it wrote", () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-cmd-"));
    // A stand-in for any TTS: copies a fixture to the path it is given.
    const script = join(dir, "fake-tts.mjs");
    writeFileSync(script, `
      import { writeFileSync } from "node:fs";
      const out = process.argv[process.argv.indexOf("--out") + 1];
      const text = process.argv[process.argv.indexOf("--text") + 1];
      writeFileSync(out, "WAV:" + text);
    `);

    const cache = join(dir, "cache");
    const res = synthesizeWithCommand("hello", {
      command: `"${process.execPath}" "${script}" --text {text} --out {out}`,
    }, cache);

    expect(existsSync(res.path)).toBe(true);
    expect(readFileSync(res.path, "utf-8")).toBe("WAV:hello");
  });

  test("a second call is a cache hit, not a second spawn", () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-cmd-"));
    const marker = join(dir, "runs.txt");
    const script = join(dir, "fake-tts.mjs");
    writeFileSync(script, `
      import { writeFileSync, appendFileSync } from "node:fs";
      const out = process.argv[process.argv.indexOf("--out") + 1];
      appendFileSync(${JSON.stringify(marker)}, "x");
      writeFileSync(out, "WAV");
    `);

    const opts = { command: `"${process.execPath}" "${script}" --text {text} --out {out}` };
    const cache = join(dir, "cache");
    synthesizeWithCommand("hi", opts, cache);
    synthesizeWithCommand("hi", opts, cache);

    expect(readFileSync(marker, "utf-8")).toBe("x");
  });

  test("a clean exit that writes nothing is an error, not a silent miss", () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-cmd-"));
    const script = join(dir, "lazy.mjs");
    writeFileSync(script, `process.exit(0);`);

    expect(() =>
      synthesizeWithCommand("hi", { command: `"${process.execPath}" "${script}" --out {out}` }, join(dir, "c"))
    ).toThrow(/wrote no file/);
  });

  test("a missing program names the program in the error", () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-cmd-"));
    expect(() =>
      synthesizeWithCommand("hi", { command: `definitely-not-a-program-xyz --out {out}` }, join(dir, "c"))
    ).toThrow(/command not found/);
  });

  test("a non-zero exit surfaces the code and the argv", () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-cmd-"));
    const script = join(dir, "fail.mjs");
    writeFileSync(script, `console.error("boom"); process.exit(3);`);

    expect(() =>
      synthesizeWithCommand("hi", { command: `"${process.execPath}" "${script}" --out {out}` }, join(dir, "c"))
    ).toThrow(/exited with code 3/);
  });
});

describe("command engine: tts() integration", () => {
  test("engine command needs a template at build time", () => {
    expect(() => tts("hi", { engine: "command" })).toThrow(/needs a command template/);
  });

  test("a command voice is not validated against the Piper voice list", () => {
    expect(() =>
      tts("नमस्ते", { engine: "command", voice: "some-model-kino-never-heard-of", command: "x {text} {out}" })
    ).not.toThrow();
  });

  test("synthesizeToWav dispatches to the command engine", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-cmd-"));
    const script = join(dir, "fake-tts.mjs");
    writeFileSync(script, `
      import { writeFileSync } from "node:fs";
      const out = process.argv[process.argv.indexOf("--out") + 1];
      writeFileSync(out, "WAV");
    `);

    const path = await synthesizeToWav("hello", {
      engine: "command",
      command: `"${process.execPath}" "${script}" --text {text} --out {out}`,
      cacheDir: join(dir, "cache"),
    });

    expect(existsSync(path)).toBe(true);
  });
});
