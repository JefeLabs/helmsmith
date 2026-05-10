import { describe, it, expect } from "vitest";
import { defineTheme } from "./tokens.ts";
import { rosePine, tokyoNight, builtInThemes } from "./themes/index.ts";

describe("defineTheme", () => {
  it("derives semantic colors from a base16 palette", () => {
    const theme = defineTheme({
      name: "test",
      displayName: "Test",
      appearance: "dark",
      palette: {
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
      },
    });

    // Surface
    expect(theme.colors.background).toBe("#000000");
    expect(theme.colors.text).toBe("#555555");
    // Intent (base0D = primary)
    expect(theme.colors.primary).toBe("#0000ff");
    // Status
    expect(theme.colors.success).toBe("#00ff00");
    expect(theme.colors.warning).toBe("#ffff00");
    expect(theme.colors.danger).toBe("#ff0000");
    // Syntax
    expect(theme.colors.syntax.string).toBe("#00ff00");
    expect(theme.colors.syntax.keyword).toBe("#ff00ff");
  });

  it("applies overrides on top of palette-derived defaults", () => {
    const theme = defineTheme({
      name: "test",
      displayName: "Test",
      appearance: "dark",
      palette: rosePine.colors.palette,
      overrides: {
        colors: { primary: "#deadbe" },
        spacing: { md: 8 },
      },
    });
    expect(theme.colors.primary).toBe("#deadbe");
    expect(theme.spacing.md).toBe(8);
    // Untouched fields preserved
    expect(theme.spacing.lg).toBe(3);
  });

  it("preserves the input palette", () => {
    const theme = defineTheme({
      name: "test",
      displayName: "Test",
      appearance: "dark",
      palette: tokyoNight.colors.palette,
    });
    expect(theme.colors.palette).toEqual(tokyoNight.colors.palette);
  });
});

describe("bundled themes", () => {
  it("registers all 4 themes by name", () => {
    expect(Object.keys(builtInThemes).sort()).toEqual([
      "catppuccin-latte",
      "catppuccin-mocha",
      "rose-pine",
      "tokyo-night",
    ]);
  });

  it("rose-pine is dark", () => {
    expect(rosePine.appearance).toBe("dark");
    expect(rosePine.colors.background).toBe("#191724");
  });

  it("each bundled theme has a complete components definition", () => {
    for (const theme of Object.values(builtInThemes)) {
      expect(theme.components.box.variants.default).toBeDefined();
      expect(theme.components.button.variants.primary).toBeDefined();
      expect(theme.components.button.sizes.md.paddingX).toBeGreaterThan(0);
      expect(theme.components.text.variants.body).toBeDefined();
    }
  });
});
