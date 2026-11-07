/**
 * Theme subsystem — public API.
 *
 * Pipeline: 16-color palette → semantic colors → typography +
 * components. `defineTheme()` runs the pipeline; `<HelmsmithThemeProvider>`
 * resolves files from `~/.helmsmith/theme/`; hooks consume the active
 * theme.
 *
 * See `theme/README.md` (TODO) and the HELMSMITH_THEME_DIR docs for the
 * full file-resolution model.
 */

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
export type { HelmsmithThemeProviderProps } from './HelmsmithThemeProvider.tsx';
// React provider
export { HelmsmithThemeProvider } from './HelmsmithThemeProvider.tsx';
export type {
  DiscoveredFile,
  HelmsmithLoadOptions,
  HelmsmithLoadResult,
  PersistHelmsmithThemeOptions,
  WatchHelmsmithOptions,
} from './helmsmith.ts';
// Helmsmith file-resolution layer
export {
  DEFAULT_FILE_BASENAME,
  findThemeFile,
  helmsmithThemeDir,
  listHelmsmithThemeFiles,
  loadHelmsmithTheme,
  persistHelmsmithTheme,
  watchHelmsmithTheme,
} from './helmsmith.ts';
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
