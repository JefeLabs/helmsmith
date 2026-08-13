/**
 * Undo/redo history for the canvas — a pure past/future stack of graph
 * snapshots, kept free of React so the semantics are unit-testable.
 *
 * Recording protocol: callers snapshot the PRE-mutation state at each
 * semantic mutation point (add, connect, edit, rename, delete,
 * relayout, drag-START — a drag coalesces to one entry). Undo swaps
 * the current state with the top of `past`, pushing current onto
 * `future`; a new recording clears `future` (branching discards the
 * old redo line, the standard model).
 */
import type { DesignerEdge, DesignerNode } from './graph-model.ts';

export interface GraphSnapshot {
  nodes: DesignerNode[];
  edges: DesignerEdge[];
}

export interface History {
  past: GraphSnapshot[];
  future: GraphSnapshot[];
}

export const emptyHistory: History = { past: [], future: [] };

export const HISTORY_CAP = 100;

/** Record a pre-mutation snapshot. Clears the redo future. */
export function recorded(h: History, snapshot: GraphSnapshot): History {
  const past = [...h.past, snapshot];
  if (past.length > HISTORY_CAP) past.splice(0, past.length - HISTORY_CAP);
  return { past, future: [] };
}

/** Step back: returns the restored snapshot and the new history, with
 *  the current state pushed onto the redo future. Null when empty. */
export function undone(
  h: History,
  current: GraphSnapshot,
): { history: History; snapshot: GraphSnapshot } | null {
  const snapshot = h.past[h.past.length - 1];
  if (!snapshot) return null;
  return {
    history: { past: h.past.slice(0, -1), future: [...h.future, current] },
    snapshot,
  };
}

/** Step forward after an undo. Null when there is no future. */
export function redone(
  h: History,
  current: GraphSnapshot,
): { history: History; snapshot: GraphSnapshot } | null {
  const snapshot = h.future[h.future.length - 1];
  if (!snapshot) return null;
  return {
    history: { past: [...h.past, current], future: h.future.slice(0, -1) },
    snapshot,
  };
}
