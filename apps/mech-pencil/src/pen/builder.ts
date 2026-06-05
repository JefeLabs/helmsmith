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

type FrameOpts = Omit<Frame, 'type' | 'id'> & Layout;
type RectOpts = Omit<Rectangle, 'type' | 'id'>;
type TextOpts = Omit<Text, 'type' | 'id' | 'content'>;
type IconOpts = Omit<IconFont, 'type' | 'id'>;
type RefOpts = Omit<Ref, 'type' | 'id' | 'ref'>;

export function frame(id: string, opts: FrameOpts = {}, children: Child[] = []): Frame {
  const node: Frame = { id, type: 'frame', ...opts };
  if (children.length > 0) node.children = children;
  return node;
}

export function rect(id: string, opts: RectOpts = {}): Rectangle {
  return { id, type: 'rectangle', ...opts };
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
  return { id, type: 'ref', ref: target, ...opts };
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
