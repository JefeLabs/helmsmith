/**
 * Hooks for consuming the theme.
 *
 *   useTheme()          → entire ThemeContextValue (theme + switchers)
 *   useThemeTokens()    → just the Theme object
 *   useThemeColors()    → just the colors slice
 *   useThemeSwitcher()  → just the switching functions
 *   useThemeKeybindings → register Ctrl+T cycle, Ctrl+Shift+T toggle
 */

import { useKeyboard } from '@opentui/react';
import { useContext } from 'react';
import { ThemeContext, type ThemeContextValue } from './context.tsx';
import type { Theme, ThemeColors } from './types.ts';

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error(
      'useTheme() called outside <ThemeProvider>. Wrap your app in <AgentxThemeProvider> (or a custom provider that supplies ThemeContext).',
    );
  }
  return ctx;
}

export function useThemeTokens(): Theme {
  return useTheme().theme;
}

export function useThemeColors(): ThemeColors {
  return useTheme().theme.colors;
}

export interface ThemeSwitcher {
  setTheme: (name: string) => void;
  cycleTheme: () => void;
  toggleAppearance: () => void;
  themes: Record<string, Theme>;
  activeName: string;
}

export function useThemeSwitcher(): ThemeSwitcher {
  const { setTheme, cycleTheme, toggleAppearance, themes, activeName } = useTheme();
  return { setTheme, cycleTheme, toggleAppearance, themes, activeName };
}

// ────────────────────────────────────────────────────────────────────
// Keybindings
// ────────────────────────────────────────────────────────────────────

/**
 * `key` shape passed by `@opentui/react`'s `useKeyboard`:
 *   { name?: string, ctrl?: boolean, meta?: boolean, shift?: boolean, ... }
 */
export interface KeyEvent {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

export type KeyMatcher = (key: KeyEvent) => boolean;

export interface ThemeKeybindingsOptions {
  /** Cycle to the next theme. Default: Ctrl+T. Pass `null` to disable. */
  cycle?: KeyMatcher | null;
  /** Toggle dark/light. Default: Ctrl+Shift+T. Pass `null` to disable. */
  toggleAppearance?: KeyMatcher | null;
}

const defaultCycleMatcher: KeyMatcher = (k) => Boolean(k.ctrl) && !k.shift && k.name === 't';
const defaultToggleMatcher: KeyMatcher = (k) =>
  Boolean(k.ctrl) && Boolean(k.shift) && k.name === 't';

/**
 * Register the standard theme keybindings: Ctrl+T cycles themes,
 * Ctrl+Shift+T toggles light/dark. Customize or disable individual
 * bindings via `opts`.
 *
 *   useThemeKeybindings(); // defaults
 *   useThemeKeybindings({ cycle: (k) => k.ctrl && k.name === "y" });
 *   useThemeKeybindings({ toggleAppearance: null }); // disable
 */
export function useThemeKeybindings(opts: ThemeKeybindingsOptions = {}): void {
  const { cycleTheme, toggleAppearance } = useTheme();
  const cycle = opts.cycle === undefined ? defaultCycleMatcher : opts.cycle;
  const toggle = opts.toggleAppearance === undefined ? defaultToggleMatcher : opts.toggleAppearance;

  useKeyboard((key: KeyEvent) => {
    if (cycle?.(key)) cycleTheme();
    if (toggle?.(key)) toggleAppearance();
  });
}

/**
 * Lower-level helper: returns the matchers + the theme switchers so
 * a caller can wire `useKeyboard` directly into a larger handler:
 *
 *   const { matchers, cycleTheme, toggleAppearance } = useThemeKeyHandlers();
 *   useKeyboard((key) => {
 *     if (matchers.cycle?.(key)) cycleTheme();
 *     if (matchers.toggleAppearance?.(key)) toggleAppearance();
 *     // ...other app-specific bindings
 *   });
 */
export function useThemeKeyHandlers(opts: ThemeKeybindingsOptions = {}): {
  matchers: { cycle: KeyMatcher | null; toggleAppearance: KeyMatcher | null };
  cycleTheme: () => void;
  toggleAppearance: () => void;
} {
  const { cycleTheme, toggleAppearance } = useTheme();
  return {
    matchers: {
      cycle: opts.cycle === undefined ? defaultCycleMatcher : opts.cycle,
      toggleAppearance:
        opts.toggleAppearance === undefined ? defaultToggleMatcher : opts.toggleAppearance,
    },
    cycleTheme,
    toggleAppearance,
  };
}
