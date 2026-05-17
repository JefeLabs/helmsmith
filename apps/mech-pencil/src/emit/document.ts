/**
 * Emit a `FrameworkAdapter` → a SINGLE `.pen` document.
 *
 * Architecture (empirically forced by the live Pencil app):
 *   - Cross-file `imports`/`ref:"alias:id"` resolve but CANNOT be
 *     customized via `descendants`. Real mockups must override
 *     component internals (card titles, button labels), so the design
 *     system and the mockups MUST live in one file with LOCAL refs.
 *
 * Layout of the produced document:
 *   - `themes` + `variables`: the adapter's tokens (colors themed
 *     light/dark, scalars flat)
 *   - one top-level "Design System" frame holding every component as a
 *     `reusable` node, atomic-ordered, parked to the right
 *   - each mockup as its own top-level screen frame, stacked down the
 *     left, instantiating components via LOCAL `ref:"<id>"`
 */

import { ATOMIC_ORDER, type BuildContext } from '../design-system/atomic.ts';
import type { TokenSet } from '../design-system/tokens.ts';
import type { FrameworkAdapter, MockupContext } from '../frameworks/adapter.ts';
import { frame } from '../pen/builder.ts';
import { PenDocument } from '../pen/document.ts';
import type { Child, VariableDecl } from '../pen/schema.ts';
import { type ValidationResult, validateDocument } from '../pen/validate.ts';

export interface EmittedDocument {
  doc: PenDocument;
  validation: ValidationResult;
  variableKeys: string[];
  componentIds: string[];
  screenSlugs: string[];
}

/** Where the design-system palette parks, clear of the screens. */
const DS_X = 1600;
const SCREEN_GAP = 96;
const DEFAULT_SCREEN_HEIGHT = 900;

function colorDecl(values: TokenSet['colors'][number]['values']): VariableDecl {
  return {
    type: 'color',
    value: [
      { value: values.light, theme: { mode: 'light' } },
      { value: values.dark, theme: { mode: 'dark' } },
    ],
  };
}

export interface EmitOptions {
  /**
   * Bind all token refs to an imported variables file instead of
   * declaring them inline. `design.pen` then carries no `variables`;
   * it `imports` `<path>` under `<alias>` and every token ref becomes
   * `$<alias>:<key>` (the verified cross-file variable form). Used by
   * the two-file brand workflow.
   */
  importedTokens?: { alias: string; path: string };
}

export function emitDocument(
  adapter: FrameworkAdapter,
  options: EmitOptions = {},
): EmittedDocument {
  const doc = new PenDocument();
  const imp = options.importedTokens;

  // Token reference prefix: `$key` inline, `$alias:key` when imported.
  const v = (key: string): string => (imp ? `$${imp.alias}:${key}` : `$${key}`);
  const buildCtx: BuildContext = {
    color: (name) => v(`color.${name}`),
    token: (key) => v(key),
  };

  const variableKeys: string[] = [];
  if (imp) {
    doc.importLib(imp.alias, imp.path);
  } else {
    const tokens = adapter.tokens();
    for (const { axis, values } of tokens.axes) doc.axis(axis, values);
    for (const c of tokens.colors) {
      doc.variable(c.key, colorDecl(c.values));
      variableKeys.push(c.key);
    }
    for (const s of tokens.scalars) {
      doc.variable(
        s.key,
        s.type === 'number'
          ? { type: 'number', value: s.value as number }
          : { type: 'string', value: s.value as string },
      );
      variableKeys.push(s.key);
    }
  }

  // Reusable components, atomic-ordered, inside one parked DS frame.
  const specs = adapter.components();
  const componentIds: string[] = [];
  const componentNodes: Child[] = [];
  for (const level of ATOMIC_ORDER) {
    for (const spec of specs.filter((s) => s.level === level)) {
      componentNodes.push(spec.build(buildCtx));
      componentIds.push(spec.id);
    }
  }
  doc.add(
    frame(
      'design-system',
      {
        name: 'Design System',
        x: DS_X,
        y: 0,
        layout: 'vertical',
        gap: 32,
        padding: 32,
        fill: v('color.background'),
      },
      componentNodes,
    ),
  );

  // Mockup screens: top-level frames, stacked down the left edge,
  // instantiating components via LOCAL refs (the only customizable
  // form). Document root has no layout, so each screen needs x/y.
  const ctx: MockupContext = {
    component: (id) => id,
    token: (key) => v(key),
  };
  const screenSlugs: string[] = [];
  let cursorY = 0;
  for (const spec of adapter.mockups?.() ?? []) {
    for (const node of spec.build(ctx)) {
      const positioned = node as Child & { x?: number; y?: number; height?: unknown };
      positioned.x = 0;
      positioned.y = cursorY;
      const h = typeof positioned.height === 'number' ? positioned.height : DEFAULT_SCREEN_HEIGHT;
      cursorY += h + SCREEN_GAP;
      doc.add(node);
    }
    screenSlugs.push(spec.slug);
  }

  return {
    doc,
    validation: validateDocument(doc.toObject()),
    variableKeys,
    componentIds,
    screenSlugs,
  };
}
