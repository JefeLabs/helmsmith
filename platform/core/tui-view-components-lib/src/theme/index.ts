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

export type { AgentxThemeProviderProps } from './AgentxThemeProvider.tsx';
// React provider
export { AgentxThemeProvider } from './AgentxThemeProvider.tsx';
export type {
  AgentxLoadOptions,
  AgentxLoadResult,
  DiscoveredFile,
  PersistAgentxThemeOptions,
  WatchAgentxOptions,
} from './agentx.ts';
// AgentX file-resolution layer
export {
  agentxThemeDir,
  DEFAULT_FILE_BASENAME,
  findThemeFile,
  listAgentxThemeFiles,
  loadAgentxTheme,
  persistAgentxTheme,
  watchAgentxTheme,
} from './agentx.ts';
// File loading + base16
export {
  applyOverride,
  applyOverrideFile,
  deepMerge,
  loadBase16File,
  loadOverrideFile,
  loadThemeFile,
  loadTintyArtifact,
  parseYaml,
  themeFromBase16,
} from './base16.ts';
export type { ThemeContextValue } from './context.tsx';
// Context (for advanced consumers building custom providers)
export { ThemeContext } from './context.tsx';
export type {
  KeyEvent,
  KeyMatcher,
  ThemeKeybindingsOptions,
  ThemeSwitcher as ThemeSwitcherApi,
} from './hooks.ts';
// Hooks
export {
  useTheme,
  useThemeColors,
  useThemeKeybindings,
  useThemeKeyHandlers,
  useThemeSwitcher,
  useThemeTokens,
} from './hooks.ts';
// Bundled themes
export {
  builtInThemes,
  catppuccinLatte,
  catppuccinMocha,
  defaultThemeName,
  rosePine,
  tokyoNight,
} from './themes/index.ts';
// Theme construction
export { defineTheme, themeFromPalette } from './tokens.ts';
// Type contract
export type {
  Base16Palette,
  BorderStyle,
  BorderTokens,
  BoxComponent,
  ButtonComponent,
  ButtonSizeStyle,
  DeepPartial,
  InputComponent,
  PanelComponent,
  SpacingKey,
  SpacingScale,
  SyntaxColors,
  TextComponent,
  Theme,
  ThemeAppearance,
  ThemeColors,
  ThemeComponents,
  ThemeDefinition,
  Typography,
  TypographyPreset,
  TypographyStyle,
} from './types.ts';

// Note: themed primitives (Box, Text, Heading, Button, Input) live
// in `atoms/`, Panel in `molecules/`, and the ThemeSwitcher picker
// in `organisms/`. Import them from the atomic layers, not from here.
