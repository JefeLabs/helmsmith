/**
 * Atomic-design classification (Brad Frost).
 *
 *   atom      indivisible UI primitive (Button, Input, Badge, Spinner)
 *   molecule  small composite of atoms (Card, Alert, Tabs, Breadcrumbs)
 *   organism  complex, composed region (Modal, Navbar, Table, Form)
 *   template  page-level scaffold (only used by mockups, not the lib)
 *
 * Each `ComponentSpec` knows how to emit itself as a single `reusable`
 * `.pen` node. The `build` function receives a `BuildContext` so a
 * component references design tokens (`ctx.color("accent")`) instead of
 * hardcoding values — that's what keeps the generated library themeable.
 */

import type { Child } from '../pen/schema.ts';
import { tokenRef } from './tokens.ts';

export type AtomicLevel = 'atom' | 'molecule' | 'organism' | 'template';

export interface BuildContext {
  /** `$color.<name>` reference, e.g. `ctx.color("accent")`. */
  color: (name: string) => string;
  /** `$<group>.<name>` reference for non-color tokens (radius, space). */
  token: (key: string) => string;
}

export interface ComponentSpec {
  /** Stable component id — the `ref` target other files instantiate. */
  id: string;
  /** Human label / canonical React export name. */
  name: string;
  level: AtomicLevel;
  /** HeroUI functional category (the 15 Storybook groups). */
  category: string;
  /** Emit the component as one reusable node (already `reusable: true`). */
  build: (ctx: BuildContext) => Child;
}

/** The default context: maps friendly names onto `$token` references. */
export const defaultBuildContext: BuildContext = {
  color: (name) => tokenRef(`color.${name}`),
  token: (key) => tokenRef(key),
};

export const ATOMIC_ORDER: AtomicLevel[] = ['atom', 'molecule', 'organism', 'template'];
