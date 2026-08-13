/**
 * Layout persistence — a browser-local sidecar, never the wire contract.
 * FlowDef deliberately carries no positions (see graph-model.ts), so
 * hand-arranged layouts live in one localStorage key mapping
 * flowId → stepId → {x,y}. Loads overlay stored positions onto the
 * dagre-computed graph (unknown steps keep the computed spot, so new
 * nodes land sensibly); saves capture the canvas wholesale, which makes
 * the store self-cleaning as steps are deleted or renamed.
 *
 * Storage is injected (Pick<Storage, ...>) so the semantics are
 * unit-testable in node; the app passes window.localStorage.
 */
import type { DesignerNode } from './graph-model.ts';

export const LAYOUT_KEY = 'helmsmith:designer:layouts';

export type FlowLayout = Record<string, { x: number; y: number }>;
export type LayoutMap = Record<string, FlowLayout>;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** Snapshot the canvas positions, keyed by step id. */
export function capturedLayout(nodes: readonly DesignerNode[]): FlowLayout {
  const out: FlowLayout = {};
  for (const n of nodes) out[n.id] = { x: n.position.x, y: n.position.y };
  return out;
}

/** Overlay a stored layout onto freshly mapped nodes. Steps without a
 *  stored position keep their computed (dagre) one. */
export function appliedLayout(
  nodes: readonly DesignerNode[],
  layout: FlowLayout | undefined,
): DesignerNode[] {
  if (!layout) return [...nodes];
  return nodes.map((n) => (layout[n.id] ? { ...n, position: { ...layout[n.id] } } : n));
}

/** All stored layouts; {} when absent or unreadable. */
export function readLayouts(storage: StorageLike): LayoutMap {
  try {
    const raw = storage.getItem(LAYOUT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as LayoutMap;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/** Snapshot merge for sidecar imports and server loads: incoming
 *  flows replace their stored layout wholesale; flows the incoming
 *  map does not mention keep their local arrangement. */
export function mergedLayouts(current: LayoutMap, incoming: LayoutMap): LayoutMap {
  return { ...current, ...incoming };
}

/** Shape detection for imported files: a layout sidecar is a
 *  non-empty object of flowId → stepId → numeric {x, y} — and never a
 *  catalog (which has a `flows` array). */
export function isLayoutFile(parsed: unknown): parsed is LayoutMap {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0) return false;
  if ('flows' in (parsed as Record<string, unknown>)) return false;
  return entries.every(([, flow]) => {
    if (!flow || typeof flow !== 'object' || Array.isArray(flow)) return false;
    return Object.values(flow as Record<string, unknown>).every(
      (pos) =>
        !!pos &&
        typeof pos === 'object' &&
        typeof (pos as { x?: unknown }).x === 'number' &&
        typeof (pos as { y?: unknown }).y === 'number',
    );
  });
}

/** Bulk merge a sidecar's layouts into storage (per-flow replace). */
export function writeLayouts(storage: StorageLike, incoming: LayoutMap): void {
  try {
    storage.setItem(LAYOUT_KEY, JSON.stringify(mergedLayouts(readLayouts(storage), incoming)));
  } catch {
    // Layout is a convenience; losing it must never break editing.
  }
}

/** The stored layouts for exactly these flows — what an export or a
 *  server save carries. Never leaks other catalogs' arrangements. */
export function layoutsForFlows(storage: StorageLike, flowIds: readonly string[]): LayoutMap {
  const all = readLayouts(storage);
  const out: LayoutMap = {};
  for (const id of flowIds) {
    if (all[id] && Object.keys(all[id]).length > 0) out[id] = all[id];
  }
  return out;
}

/** Replace one flow's layout, preserving the others. Swallows storage
 *  failures (private mode, quota) — persistence is best-effort. */
export function writeLayout(storage: StorageLike, flowId: string, layout: FlowLayout): void {
  try {
    const all = readLayouts(storage);
    all[flowId] = layout;
    storage.setItem(LAYOUT_KEY, JSON.stringify(all));
  } catch {
    // Layout is a convenience; losing it must never break editing.
  }
}
