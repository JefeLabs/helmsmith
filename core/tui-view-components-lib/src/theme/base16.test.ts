import { describe, it, expect } from "vitest";
import {
  parseYaml,
  themeFromBase16,
  applyOverride,
  deepMerge,
} from "./base16.ts";
import { rosePine } from "./themes/index.ts";

describe("parseYaml", () => {
  it("parses key-value pairs", () => {
    const out = parseYaml(`
      foo: bar
      baz: 42
    `);
    expect(out).toEqual({ foo: "bar", baz: 42 });
  });

  it("parses nested objects via indentation", () => {
    const out = parseYaml(`
parent:
  child: value
  nested:
    deep: thing
`);
    expect(out).toEqual({
      parent: { child: "value", nested: { deep: "thing" } },
    });
  });

  it("strips quotes from string values", () => {
    expect(parseYaml(`name: "Tokyo Night"`)).toEqual({ name: "Tokyo Night" });
    expect(parseYaml(`name: 'Tokyo Night'`)).toEqual({ name: "Tokyo Night" });
  });

  it("ignores comment lines", () => {
    expect(
      parseYaml(`# this is a comment
foo: bar
# another comment`),
    ).toEqual({ foo: "bar" });
  });
});

describe("themeFromBase16", () => {
  it("builds a theme from a flat base16 record", () => {
    const theme = themeFromBase16({
      scheme: "Test Scheme",
      base00: "#000000",
      base01: "#111111",
      base02: "#222222",
      base03: "#333333",
      base04: "#444444",
      base05: "#555555",
      base06: "#666666",
      base07: "#777777",
      base08: "#ff0000",
      base09: "#ff7700",
      base0A: "#ffff00",
      base0B: "#00ff00",
      base0C: "#00ffff",
      base0D: "#0000ff",
      base0E: "#ff00ff",
      base0F: "#7f0000",
    });
    expect(theme.name).toBe("test-scheme");
    expect(theme.displayName).toBe("Test Scheme");
    expect(theme.colors.background).toBe("#000000");
  });

  it("auto-detects appearance from base00 luminance", () => {
    const dark = themeFromBase16({
      base00: "#000000", base01: "#111111", base02: "#222", base03: "#333",
      base04: "#444", base05: "#555", base06: "#666", base07: "#777",
      base08: "#f00", base09: "#f70", base0A: "#ff0", base0B: "#0f0",
      base0C: "#0ff", base0D: "#00f", base0E: "#f0f", base0F: "#700",
    });
    const light = themeFromBase16({
      base00: "#ffffff", base01: "#eeeeee", base02: "#dddddd", base03: "#ccc",
      base04: "#bbb", base05: "#444", base06: "#333", base07: "#222",
      base08: "#c00", base09: "#960", base0A: "#a90", base0B: "#080",
      base0C: "#077", base0D: "#005", base0E: "#608", base0F: "#600",
    });
    expect(dark.appearance).toBe("dark");
    expect(light.appearance).toBe("light");
  });
});

describe("deepMerge", () => {
  it("merges nested plain objects recursively", () => {
    const base = { a: 1, b: { c: 2, d: 3 }, e: { f: { g: 4 } } };
    const override = { b: { c: 20 }, e: { f: { h: 5 } } };
    expect(deepMerge(base, override)).toEqual({
      a: 1,
      b: { c: 20, d: 3 },
      e: { f: { g: 4, h: 5 } },
    });
  });

  it("ignores undefined values in the override", () => {
    expect(deepMerge({ a: 1 }, { a: undefined as unknown })).toEqual({ a: 1 });
  });

  it("override wins for non-plain values (arrays, primitives)", () => {
    expect(deepMerge({ a: [1, 2] }, { a: [3] })).toEqual({ a: [3] });
    expect(deepMerge({ a: "x" }, { a: "y" })).toEqual({ a: "y" });
  });
});

describe("applyOverride", () => {
  it("layers a partial override onto a resolved theme", () => {
    const customized = applyOverride(rosePine, {
      colors: { primary: "#ff79c6" },
    });
    expect(customized.colors.primary).toBe("#ff79c6");
    // Untouched
    expect(customized.colors.background).toBe(rosePine.colors.background);
    expect(customized.spacing.md).toBe(rosePine.spacing.md);
  });
});
