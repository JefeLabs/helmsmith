/**
 * Theme subsystem — public API.
 *
 * Pipeline: 16-color palette → semantic colors → typography +
 * components. `defineTheme()` runs the pipeline; `<AgentxThemeProvider>`
 * resolves files from `~/.agentx/theme/`; hooks consume the active
 * theme.
 *
 * See `theme/README.md` (TODO) and the AGENTX_THEME_DIR docs for the
 * full file-resolution model.
 */

// Type contract
export type {
  Base16Palette,
  Theme,
  ThemeAppearance,
  ThemeColors,
  ThemeComponents,
  ThemeDefinition,
  Typography,
  TypographyPreset,
  TypographyStyle,
  SpacingScale,
  SpacingKey,
  BorderStyle,
  BorderTokens,
  SyntaxColors,
  BoxComponent,
  TextComponent,
  ButtonComponent,
  ButtonSizeStyle,
  InputComponent,
  PanelComponent,
  DeepPartial,
} from "./types.ts";

// Theme construction
export { defineTheme, themeFromPalette } from "./tokens.ts";

// File loading + base16
export {
  parseYaml,
  themeFromBase16,
  loadThemeFile,
  loadOverrideFile,
  applyOverride,
  applyOverrideFile,
  loadBase16File,
  loadTintyArtifact,
  deepMerge,
} from "./base16.ts";

// Bundled themes
export {
  rosePine,
  tokyoNight,
  catppuccinMocha,
  catppuccinLatte,
  builtInThemes,
  defaultThemeName,
} from "./themes/index.ts";

// AgentX file-resolution layer
export {
  agentxThemeDir,
  loadAgentxTheme,
  persistAgentxTheme,
  watchAgentxTheme,
  listAgentxThemeFiles,
  findThemeFile,
  DEFAULT_FILE_BASENAME,
} from "./agentx.ts";
export type {
  AgentxLoadOptions,
  AgentxLoadResult,
  WatchAgentxOptions,
  PersistAgentxThemeOptions,
  DiscoveredFile,
} from "./agentx.ts";

// React provider
export { AgentxThemeProvider } from "./AgentxThemeProvider.tsx";
export type { AgentxThemeProviderProps } from "./AgentxThemeProvider.tsx";

// Context (for advanced consumers building custom providers)
export { ThemeContext } from "./context.tsx";
export type { ThemeContextValue } from "./context.tsx";

// Hooks
export {
  useTheme,
  useThemeTokens,
  useThemeColors,
  useThemeSwitcher,
  useThemeKeyHandlers,
  useThemeKeybindings,
} from "./hooks.ts";
export type {
  ThemeSwitcher as ThemeSwitcherApi,
  ThemeKeybindingsOptions,
  KeyEvent,
  KeyMatcher,
} from "./hooks.ts";

// Note: themed primitives (Box, Text, Heading, Button, Input) live
// in `atoms/`, Panel in `molecules/`, and the ThemeSwitcher picker
// in `organisms/`. Import them from the atomic layers, not from here.
