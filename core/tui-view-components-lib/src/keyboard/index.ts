/**
 * Keyboard subsystem — infrastructure for keybinding registration
 * and routing.
 *
 *   <KeyboardProvider>     mounts root key listener
 *   useKeybinding(...)     register a binding while mounted
 *   useKeybindings()       read the current registry
 *
 * The visual `<KeybindingsBar>` lives in `molecules/` (it composes
 * Box + Text from atoms — not a pure keyboard concern).
 */

export {
  KeyboardProvider,
  useKeybinding,
  useKeybindings,
} from "./registry.tsx";
export type {
  KeyboardProviderProps,
  KeybindingEntry,
  KeyEvent,
  KeyMatcher,
  UseKeybindingOptions,
} from "./registry.tsx";
