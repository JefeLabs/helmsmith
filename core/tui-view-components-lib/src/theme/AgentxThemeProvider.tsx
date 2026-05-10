/**
 * `<AgentxThemeProvider>` — agentx-flavored ThemeProvider.
 *
 * Resolves the active theme from the standard agentx layout:
 *
 *   built-in fallback → ~/.agentx/theme/default.* → ~/.agentx/theme/<appName>.*
 *
 * Persistence: when the user changes themes via the in-TUI switcher,
 * the chosen theme overwrites `~/.agentx/theme/default.json`.
 *
 * Hot reload: edits to either the default or the app override file
 * re-resolve and re-render automatically.
 *
 * Built-in themes (Rosé Pine, Tokyo Night, Catppuccin) remain
 * available in the picker — switching to one writes its content into
 * the default file.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ThemeContext, type ThemeContextValue } from "./context.tsx";
import {
  agentxThemeDir,
  loadAgentxTheme,
  persistAgentxTheme,
  watchAgentxTheme,
} from "./agentx.ts";
import { applyOverrideFile } from "./base16.ts";
import { builtInThemes, defaultThemeName } from "./themes/index.ts";
import type { Theme, ThemeAppearance } from "./types.ts";

export interface AgentxThemeProviderProps {
  children: ReactNode;

  /** App identifier — drives the per-app override filename. */
  appName?: string;

  /** Theme used when no `default.*` file exists yet. */
  fallbackThemeName?: string;

  /** Override the directory (mostly for tests). */
  themeDir?: string;

  /** Subscribe to file changes in the agentx dir. Default: true. */
  watch?: boolean;

  /**
   * Inject extra themes into the picker registry. The built-in
   * themes are always included.
   */
  extraThemes?: Record<string, Theme>;
}

export function AgentxThemeProvider({
  children,
  appName,
  fallbackThemeName = defaultThemeName,
  themeDir,
  watch = true,
  extraThemes,
}: AgentxThemeProviderProps) {
  const dir = themeDir ?? agentxThemeDir();
  const fallback = builtInThemes[fallbackThemeName] ?? builtInThemes[defaultThemeName]!;

  // Static registry available to the picker — built-ins plus extras.
  const themes = useMemo<Record<string, Theme>>(
    () => ({ ...builtInThemes, ...(extraThemes ?? {}) }),
    [extraThemes],
  );

  // Initial resolution
  const [resolved, setResolved] = useState<Theme>(
    () => loadAgentxTheme({ appName, fallback, themeDir: dir }).theme,
  );

  // Hot reload
  useEffect(() => {
    if (!watch) return;
    return watchAgentxTheme(
      { appName, fallback, themeDir: dir },
      ({ theme: next }) => setResolved(next),
    );
  }, [watch, appName, dir, fallback]);

  // Switching: write the chosen theme to default.json, then re-resolve
  // (re-resolving picks up any app override, which still applies).
  const setTheme = useCallback(
    (name: string) => {
      const target = themes[name];
      if (!target) return;
      persistAgentxTheme(target, { themeDir: dir });
      // Re-resolve so the per-app override re-applies on top.
      let next = target;
      if (appName) {
        try {
          const candidate = loadAgentxTheme({ appName, fallback: target, themeDir: dir });
          next = candidate.theme;
        } catch {
          // fall back to the picked theme as-is
        }
      }
      setResolved(next);
    },
    [themes, dir, appName],
  );

  const cycleTheme = useCallback(() => {
    const names = Object.keys(themes);
    if (names.length === 0) return;
    const idx = names.findIndex((n) => themes[n]!.name === resolved.name);
    setTheme(names[(idx + 1) % names.length]!);
  }, [themes, resolved.name, setTheme]);

  const toggleAppearance = useCallback(() => {
    const target: ThemeAppearance = resolved.appearance === "dark" ? "light" : "dark";
    const candidate = Object.values(themes).find((t) => t.appearance === target);
    if (candidate) setTheme(candidate.name);
  }, [themes, resolved.appearance, setTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: resolved,
      activeName: resolved.name,
      themes,
      setTheme,
      cycleTheme,
      toggleAppearance,
    }),
    [resolved, themes, setTheme, cycleTheme, toggleAppearance],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
