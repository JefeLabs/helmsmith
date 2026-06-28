/**
 * ThemeContext + value type. The actual provider lives in
 * `AgentxThemeProvider.tsx`; this file just exports the context so
 * any consumer (`useTheme()` hook, future custom providers) can hook
 * into the same value.
 */

import { createContext } from 'react';
import type { Theme } from './types.ts';

export interface ThemeContextValue {
  /** The currently-resolved theme. */
  theme: Theme;
  /** Active theme's name (same as `theme.name`, for convenience). */
  activeName: string;
  /** Registry of all themes the picker can switch between. */
  themes: Record<string, Theme>;
  /** Switch to a registered theme by name. Persists. */
  setTheme: (name: string) => void;
  /** Cycle to the next theme in registration order. */
  cycleTheme: () => void;
  /** Switch to the next theme of the opposite appearance. */
  toggleAppearance: () => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);
