/**
 * Ergonomic constructors for `.pen` nodes.
 *
 * These are thin: they exist so framework adapters read like a layout
 * spec ("a vertical frame with a centered text child") instead of a
 * wall of object literals, while still producing plain schema objects
 * that `validate.ts` and `PenDocument` accept unchanged.
 *
 * `id` is required everywhere — Pencil resolves `ref`/`descendants`
 * paths by id, so stable, meaningful ids are load-bearing, not cosmetic.
 */

import type {
  Child,
  Fills,
  Frame,
  IconFont,
  Layout,
  Rectangle,
  Ref,
  Text,
} from './schema.ts';

/** Slug an arbitrary label into a stable, path-safe id segment. */
export function slug(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Normalize a legacy `stroke: {thickness, fill, align}` into the current
 * schema — `stroke` as a Fill, with `strokeWidth`/`strokeAlignment` as
 * siblings. The nested form renders but **crashes the Pencil app when a
 * node referencing it is clicked**; this lets call sites stay terse while
 * emitting the resolvable shape. A Fill stroke (string / Fill object /
 * array) passes through untouched.
 */
function normalizeStroke<T extends { stroke?: unknown }>(opts: T): T {
  const s = opts.stroke;
  if (s == null || typeof s !== 'object' || Array.isArray(s)) return opts; // string Fill or none
  const obj = s as Record<string, unknown>;
  const isLegacy = 'thickness' in obj || 'align' in obj || ('fill' in obj && !('type' in obj));
  if (!isLegacy) return opts; // a Fill object (has `type`) — leave it
  const { stroke: _legacy, ...rest } = opts;
  const align = obj.align;
  return {
    ...rest,
    ...(obj.fill !== undefined ? { stroke: obj.fill } : {}),
    ...(obj.thickness !== undefined ? { strokeWidth: obj.thickness } : {}),
    strokeAlignment: align === 'center' ? 'center' : align === 'outside' ? 'outer' : 'inner',
  } as unknown as T;
}

type FrameOpts = Omit<Frame, 'type' | 'id'> & Layout;
type RectOpts = Omit<Rectangle, 'type' | 'id'>;
type TextOpts = Omit<Text, 'type' | 'id' | 'content'>;
type IconOpts = Omit<IconFont, 'type' | 'id'>;
type RefOpts = Omit<Ref, 'type' | 'id' | 'ref'>;

/**
 * Bare `fit_content` is a legacy size form; Pencil's current schema wants the
 * parenthesized `fit_content(0)` (min fallback) and the bare form trips node
 * interaction (clicking crashes). `fill_container` stays bare.
 */
function fixFitContent(node: { width?: unknown; height?: unknown }): void {
  if (node.width === 'fit_content') node.width = 'fit_content(0)';
  if (node.height === 'fit_content') node.height = 'fit_content(0)';
}

export function frame(id: string, opts: FrameOpts = {}, children: Child[] = []): Frame {
  const node: Frame = { id, type: 'frame', ...normalizeStroke(opts) };
  // `horizontal` is Pencil's IMPLICIT default layout — the app never writes it,
  // and the explicit `layout:"horizontal"` form trips up node interaction
  // (clicking crashes). Emit only `vertical`/`none`; drop explicit horizontal.
  if (node.layout === 'horizontal') delete node.layout;
  fixFitContent(node);
  if (children.length > 0) node.children = children;
  return node;
}

export function rect(id: string, opts: RectOpts = {}): Rectangle {
  const node: Rectangle = { id, type: 'rectangle', ...normalizeStroke(opts) };
  fixFitContent(node);
  return node;
}

export function text(id: string, content: string, opts: TextOpts = {}): Text {
  return { id, type: 'text', content, ...opts };
}

export function icon(id: string, name: string, opts: IconOpts = {}): IconFont {
  return { id, type: 'icon_font', icon: name, iconFontFamily: 'lucide', ...opts };
}

/**
 * Instantiate a `reusable` component. `target` is the component id
 * (use `"<alias>/<id>"` for a component pulled from an imported
 * library). Pass `descendants` to patch nested children by id path.
 */
export function ref(id: string, target: string, opts: RefOpts = {}): Ref {
  return { id, type: 'ref', ref: target, ...normalizeStroke(opts) };
}

/** Mark any node as a reusable component definition (a library export). */
export function reusable<T extends Child>(node: T): T {
  return { ...node, reusable: true };
}

/** Tag a node with atomic-design metadata so consumers can group it. */
export function withMeta<T extends Child>(
  node: T,
  meta: { type: string; [k: string]: unknown },
): T {
  return { ...node, metadata: meta };
}

/** Convenience: a solid color fill from a token reference or hex. */
export function fill(color: string): Fills {
  return color;
}
