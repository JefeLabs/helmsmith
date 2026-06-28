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

import { useKeyboard } from '@opentui/react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

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
  /** Handler receives the matched KeyEvent so a single binding can
   *  match a class of keys (e.g. any digit) and dispatch on the value.
   *  Return `false` to indicate the handler declined to consume the
   *  key — dispatch will continue to the next matching binding. Any
   *  other return value (including `undefined`) counts as consumed.
   *  `void` is in the union because every caller passes a `() => void`
   *  handler — opting out via `false` is the rare, explicit case. */
  // biome-ignore lint/suspicious/noConfusingVoidType: the union is intentional — `void` keeps the ubiquitous `() => void` handlers assignable, `false` is the documented decline signal the dispatch loop reads.
  handler: (key: KeyEvent) => void | false;
}

interface KeyboardContextValue {
  bindings: KeybindingEntry[];
  register: (entry: KeybindingEntry) => () => void;
}

const KeyboardContext = createContext<KeyboardContextValue | null>(null);

function matches(matcher: KeyMatcher, key: KeyEvent): boolean {
  if (typeof matcher === 'string') return key.name === matcher;
  return matcher(key);
}

let nextId = 0;

export interface KeyboardProviderProps {
  children?: ReactNode;
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
  // Iterate bindings in priority order; the first handler that returns
  // anything other than `false` consumes the key and dispatch stops.
  // A handler that returns `false` declines the key — we keep looking.
  useKeyboard((key: KeyEvent) => {
    for (const b of bindingsRef.current) {
      if (!matches(b.match, key)) continue;
      const consumed = b.handler(key);
      if (consumed !== false) return;
    }
  });

  const value = useMemo<KeyboardContextValue>(() => ({ bindings, register }), [bindings, register]);

  return <KeyboardContext.Provider value={value}>{children}</KeyboardContext.Provider>;
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
  // biome-ignore lint/suspicious/noConfusingVoidType: matches KeybindingEntry.handler — `void` keeps `() => void` callers assignable, `false` is the decline signal.
  handler: (key: KeyEvent) => void | false,
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
      keyDisplay: opts.keyDisplay ?? (typeof match === 'string' ? match : undefined) ?? label,
      priority: opts.priority,
      hidden: opts.hidden,
      handler: (key) => handlerRef.current(key),
    };
    return ctx.register(entry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, label, opts.enabled, opts.priority, opts.hidden, opts.keyDisplay, match]);
}

/**
 * Read the current registry. The KeybindingsBar uses this to render
 * the bottom help line.
 */
export function useKeybindings(): KeybindingEntry[] {
  const ctx = useContext(KeyboardContext);
  return ctx?.bindings ?? [];
}
