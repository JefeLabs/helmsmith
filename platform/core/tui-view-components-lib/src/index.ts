/**
 * @helmsmith/tui-view-components — public API
 *
 * Components are organized via Brad Frost's Atomic Design
 * (https://atomicdesign.bradfrost.com/):
 *
 *   atoms/      single-element building blocks (Box, Text, Heading,
 *               Button, Input)
 *   molecules/  small composites of atoms (Panel, Spinner,
 *               KeybindingsBar)
 *   organisms/  complex stateful widgets (StatusList, SelectList,
 *               Confirm, Table, ThemeSwitcher)
 *   templates/  layout/provider scaffolding shared across pages
 *               (AppShell)
 *   pages/      full-screen experiences ready to launch from a CLI
 *               handler (ConnectView, runConnectView)
 *
 * Cross-cutting infrastructure (not in the atomic hierarchy):
 *   theme/      design tokens, palette → semantics pipeline,
 *               AgentxThemeProvider, hooks, bundled themes
 *   focus/      FocusManager + useFocus hook
 *   keyboard/   KeyboardProvider + useKeybinding hook + registry
 *
 * Subpath imports for tree-shaking:
 *
 *   import { Box, Text } from '@helmsmith/tui-view-components/atoms';
 *   import { Panel } from '@helmsmith/tui-view-components/molecules';
 *   import { Table } from '@helmsmith/tui-view-components/organisms';
 *   import { AppShell } from '@helmsmith/tui-view-components/templates';
 *   import { runConnectView } from '@helmsmith/tui-view-components/pages';
 */

// Atomic layers
export * from './atoms/index.ts';
// Connection contract
export type {
  Connection,
  ConnectionState,
  ConnectionStatus,
  ProgressCallback,
} from './connection.ts';
export { noopConnection } from './connection.ts';
// Focus subsystem (infrastructure)
export * from './focus/index.ts';
export type {
  KeybindingEntry,
  KeyboardProviderProps,
  UseKeybindingOptions,
} from './keyboard/index.ts';
// Keyboard subsystem (infrastructure)
export {
  KeyboardProvider,
  useKeybinding,
  useKeybindings,
} from './keyboard/index.ts';
export * from './molecules/index.ts';
export * from './organisms/index.ts';
export * from './pages/index.ts';
export * from './templates/index.ts';
// Theme subsystem (infrastructure)
export * from './theme/index.ts';
