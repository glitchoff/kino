import { describe, test, expect } from "vitest";
import { parseRenderArgs } from "../src/cli-args.js";

describe("browser engine selection", () => {
  test("defaults to chrome when nothing is passed", () => {
    const { options } = parseRenderArgs(["file.ts"]);
    expect(options.browser).toBeUndefined();
  });

  test("--browser obscura is accepted", () => {
    const { options } = parseRenderArgs(["file.ts", "--browser", "obscura"]);
    expect(options.browser).toBe("obscura");
  });

  test("--browser auto and --browser-url are parsed together", () => {
    const { options } = parseRenderArgs([
      "file.ts",
      "--browser",
      "auto",
      "--browser-url",
      "http://127.0.0.1:9333",
    ]);
    expect(options.browser).toBe("auto");
    expect(options.browserUrl).toBe("http://127.0.0.1:9333");
  });

  test("--browser-path still works alongside the engine flag", () => {
    const { options } = parseRenderArgs([
      "file.ts",
      "--browser",
      "chrome",
      "--browser-path",
      "/usr/bin/chromium",
    ]);
    expect(options.browser).toBe("chrome");
    expect(options.browserPath).toBe("/usr/bin/chromium");
  });
});
