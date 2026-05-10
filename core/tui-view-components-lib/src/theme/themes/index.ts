/**
 * Bundled themes — always available in the picker. Apps can add more
 * via the `extraThemes` prop on `<AgentxThemeProvider>`.
 */

import type { Theme } from "../types.ts";
import { rosePine } from "./rose-pine.ts";
import { tokyoNight } from "./tokyo-night.ts";
import { catppuccinMocha } from "./catppuccin-mocha.ts";
import { catppuccinLatte } from "./catppuccin-latte.ts";

export { rosePine, tokyoNight, catppuccinMocha, catppuccinLatte };

/** Registry keyed by theme name. */
export const builtInThemes: Record<string, Theme> = {
  [rosePine.name]: rosePine,
  [tokyoNight.name]: tokyoNight,
  [catppuccinMocha.name]: catppuccinMocha,
  [catppuccinLatte.name]: catppuccinLatte,
};

/** Default fallback when nothing else is available. */
export const defaultThemeName = rosePine.name;
