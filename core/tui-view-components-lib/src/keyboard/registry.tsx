/**
 * Keyboard subsystem — global keybinding registry + router.
 *
 * Pattern:
 *   <KeyboardProvider>      mounts useKeyboard once at the root
 *     <App />
 *       useKeybinding("q", "quit", quit)   ← registers + auto-unregisters
 *       useKeybinding("?", "help", showHelp)
 *     <KeybindingsBar />    reads registry, renders bottom bar
 *   </KeyboardProvider>
 *
 * Bindings are matched by `KeyMatcher` functions (not just key names)
 * so consumers can express "Ctrl+S" or "Esc when in modal" cleanly.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useKeyboard } from "@opentui/react";

export interface KeyEvent {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

export type KeyMatcher = string | ((key: KeyEvent) => boolean);

export interface KeybindingEntry {
  /** Stable id (used for unregister; usually auto-generated). */
  id: string;
  /** Match function, or a key name (e.g. "q", "tab", "return"). */
  match: KeyMatcher;
  /** Human-readable label shown in the help bar (e.g. "quit", "submit"). */
  label: string;
  /** Display string for the key (e.g. "q", "Ctrl+S"). Defaults to the
   *  match string if `match` is a string, or the label otherwise. */
  keyDisplay?: string;
  /** Lower priority bindings fire first. Lets a parent override a child. */
  priority?: number;
  /** Hide from the help bar. Useful for invisible global bindings. */
  hidden?: boolean;
  handler: () => void;
}

interface KeyboardContextValue {
  bindings: KeybindingEntry[];
  register: (entry: KeybindingEntry) => () => void;
}

const KeyboardContext = createContext<KeyboardContextValue | null>(null);

function matches(matcher: KeyMatcher, key: KeyEvent): boolean {
  if (typeof matcher === "string") return key.name === matcher;
  return matcher(key);
}

let nextId = 0;

export interface KeyboardProviderProps {
  children: ReactNode;
}

export function KeyboardProvider({ children }: KeyboardProviderProps) {
  const [bindings, setBindings] = useState<KeybindingEntry[]>([]);
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  const register = useCallback((entry: KeybindingEntry) => {
    setBindings((prev) => {
      const next = [...prev, entry];
      next.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
      return next;
    });
    return () => {
      setBindings((prev) => prev.filter((e) => e.id !== entry.id));
    };
  }, []);

  // Mount the actual openTUI keyboard listener once at the provider.
  useKeyboard((key: KeyEvent) => {
    for (const b of bindingsRef.current) {
      if (matches(b.match, key)) {
        b.handler();
        return;
      }
    }
  });

  const value = useMemo<KeyboardContextValue>(
    () => ({ bindings, register }),
    [bindings, register],
  );

  return (
    <KeyboardContext.Provider value={value}>
      {children}
    </KeyboardContext.Provider>
  );
}

// ────────────────────────────────────────────────────────────────────
// Hooks
// ────────────────────────────────────────────────────────────────────

export interface UseKeybindingOptions {
  keyDisplay?: string;
  priority?: number;
  hidden?: boolean;
  /** Set to false to temporarily disable. Re-enable to re-register. */
  enabled?: boolean;
}

/**
 * Register a keybinding while the component is mounted. Auto-cleans
 * up on unmount. The handler is called on the matching key event.
 *
 *   useKeybinding("q", "quit", () => process.exit(0));
 *   useKeybinding(
 *     (k) => k.ctrl && k.name === "s",
 *     "save",
 *     handleSave,
 *     { keyDisplay: "Ctrl+S" }
 *   );
 */
export function useKeybinding(
  match: KeyMatcher,
  label: string,
  handler: () => void,
  opts: UseKeybindingOptions = {},
): void {
  const ctx = useContext(KeyboardContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!ctx) return;
    if (opts.enabled === false) return;
    const entry: KeybindingEntry = {
      id: `kb-${nextId++}`,
      match,
      label,
      keyDisplay:
        opts.keyDisplay ??
        (typeof match === "string" ? match : undefined) ??
        label,
      priority: opts.priority,
      hidden: opts.hidden,
      handler: () => handlerRef.current(),
    };
    return ctx.register(entry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, label, opts.enabled, opts.priority, opts.hidden]);
}

/**
 * Read the current registry. The KeybindingsBar uses this to render
 * the bottom help line.
 */
export function useKeybindings(): KeybindingEntry[] {
  const ctx = useContext(KeyboardContext);
  return ctx?.bindings ?? [];
}
