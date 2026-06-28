/**
 * Focus subsystem — centralized focus manager.
 *
 * One `<FocusManager>` at the root tracks all focusable IDs in
 * registration order. Components call `useFocus(id)` to register
 * themselves and read `isFocused`. Tab/Shift+Tab move focus through
 * the ordered list.
 */

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

interface FocusEntry {
  id: string;
  /** Lower order = focused earlier in tab traversal. Defaults to registration order. */
  order: number;
}

interface FocusContextValue {
  focusedId: string | null;
  register: (id: string, order?: number) => void;
  unregister: (id: string) => void;
  request: (id: string) => void;
  release: (id: string) => void;
  next: () => void;
  prev: () => void;
}

const FocusContext = createContext<FocusContextValue | null>(null);

export interface FocusManagerProps {
  /** Optional initial focused id. Otherwise starts unfocused until requested. */
  initialFocus?: string;
  children: ReactNode;
}

export function FocusManager({ initialFocus, children }: FocusManagerProps) {
  const entriesRef = useRef<FocusEntry[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(initialFocus ?? null);

  const register = useCallback((id: string, order?: number) => {
    const list = entriesRef.current;
    if (list.some((e) => e.id === id)) return;
    list.push({ id, order: order ?? list.length });
    list.sort((a, b) => a.order - b.order);
    setFocusedId((curr) => curr ?? id);
  }, []);

  const unregister = useCallback((id: string) => {
    entriesRef.current = entriesRef.current.filter((e) => e.id !== id);
    setFocusedId((curr) => {
      if (curr !== id) return curr;
      return entriesRef.current[0]?.id ?? null;
    });
  }, []);

  const request = useCallback((id: string) => {
    if (entriesRef.current.some((e) => e.id === id)) {
      setFocusedId(id);
    }
  }, []);

  const release = useCallback((id: string) => {
    setFocusedId((curr) => {
      if (curr !== id) return curr;
      return entriesRef.current[0]?.id ?? null;
    });
  }, []);

  const move = useCallback((delta: 1 | -1) => {
    const list = entriesRef.current;
    if (list.length === 0) return;
    setFocusedId((curr) => {
      const idx = curr ? list.findIndex((e) => e.id === curr) : -1;
      const nextIdx = idx < 0 ? 0 : (idx + delta + list.length) % list.length;
      return list[nextIdx]?.id ?? null;
    });
  }, []);

  const next = useCallback(() => move(1), [move]);
  const prev = useCallback(() => move(-1), [move]);

  const value = useMemo<FocusContextValue>(
    () => ({ focusedId, register, unregister, request, release, next, prev }),
    [focusedId, register, unregister, request, release, next, prev],
  );

  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}

// ────────────────────────────────────────────────────────────────────
// Hooks
// ────────────────────────────────────────────────────────────────────

export interface UseFocusResult {
  isFocused: boolean;
  request: () => void;
  release: () => void;
}

/**
 * Register a focusable id with the manager. Returns whether this id
 * is currently focused, plus imperative request/release helpers.
 *
 * If called outside `<FocusManager>`, returns sensible defaults
 * (`isFocused: false`, no-op handlers) so components can be used
 * standalone without crashing.
 */
export function useFocus(id: string, order?: number): UseFocusResult {
  const ctx = useContext(FocusContext);

  useEffect(() => {
    if (!ctx) return;
    ctx.register(id, order);
    return () => ctx.unregister(id);
  }, [ctx, id, order]);

  if (!ctx) {
    return {
      isFocused: false,
      request: () => {},
      release: () => {},
    };
  }
  return {
    isFocused: ctx.focusedId === id,
    request: () => ctx.request(id),
    release: () => ctx.release(id),
  };
}

/**
 * Imperative access to the focus manager (move focus, query state).
 * Useful for keyboard handlers that drive Tab traversal.
 */
export function useFocusController(): {
  focusedId: string | null;
  next: () => void;
  prev: () => void;
  request: (id: string) => void;
} {
  const ctx = useContext(FocusContext);
  if (!ctx) {
    return {
      focusedId: null,
      next: () => {},
      prev: () => {},
      request: () => {},
    };
  }
  return {
    focusedId: ctx.focusedId,
    next: ctx.next,
    prev: ctx.prev,
    request: ctx.request,
  };
}
