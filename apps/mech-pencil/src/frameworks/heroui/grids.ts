/**
 * HeroUI grids & spacing foundation — the `grids` DECISION page.
 *
 * Renders the spacing scale (a bar per `$space.*` token) and the layout grid
 * (N columns separated by the `$grid.gutter` token). Both bind the same
 * scalars components consume, so the foundation and the catalog reskin
 * together — the icons/typography pattern, third time.
 */

import type { GridSpacingFoundation } from '../../design-system/grids.ts';
import { frame, rect, text } from '../../pen/builder.ts';
import type { Child } from '../../pen/schema.ts';
import type { FoundationSpec, MockupContext } from '../_core/adapter.ts';

export const HEROUI_GRID: GridSpacingFoundation = {
  spaceKeys: [
    'space.1', 'space.2', 'space.3', 'space.4', 'space.5',
    'space.6', 'space.8', 'space.10', 'space.12', 'space.16',
  ],
  columnsKey: 'grid.columns',
  gutterKey: 'grid.gutter',
  marginKey: 'grid.margin',
  maxWidthKey: 'grid.max',
  columns: 12,
};

const GRID_DEMO_WIDTH = 760;

function buildGridsPage(ctx: MockupContext, gs: GridSpacingFoundation): Child[] {
  let seq = 0;
  const nid = (p: string) => `fg-${p}-${seq++}`;
  const fg = ctx.token('color.foreground');
  const muted = ctx.token('color.muted');
  const fam = ctx.token('font.family');
  const monoFam = ctx.token('font.mono');

  const header = frame('fg-header', { name: 'Header', layout: 'vertical', gap: 4 }, [
    text('fg-title', 'Grids & Spacing', { fill: fg, fontFamily: ctx.token('font.display'), fontSize: 28, fontWeight: '700' }),
    text('fg-sub', `${gs.spaceKeys.length}-step spacing scale · ${gs.columns}-column layout grid`, {
      fill: muted,
      fontFamily: monoFam,
      fontSize: 14,
    }),
  ]);

  // Spacing scale — a bar sized by each $space.* token.
  const spaceRows = gs.spaceKeys.map((key) =>
    frame(nid('srow'), { name: key, layout: 'horizontal', gap: 12, alignItems: 'center' }, [
      rect(nid('sbar'), { width: ctx.token(key), height: 14, fill: ctx.token('color.accent'), cornerRadius: 3 }),
      text(nid('slabel'), key.replace('space.', 'space-'), { fill: muted, fontFamily: monoFam, fontSize: 11 }),
    ]),
  );
  const spacing = frame('fg-spacing', { name: 'Spacing scale', layout: 'vertical', gap: 8 }, [
    text('fg-spacing-h', 'Spacing scale', { fill: fg, fontFamily: fam, fontSize: 14, fontWeight: '600' }),
    frame('fg-spacing-list', { name: 'list', layout: 'vertical', gap: 8 }, spaceRows),
  ]);

  // Layout grid — N equal columns separated by the $grid.gutter token.
  const columns = Array.from({ length: gs.columns }, () =>
    rect(nid('col'), { width: 'fill_container', height: 96, fill: ctx.token('color.surface-secondary'), cornerRadius: 4 }),
  );
  const grid = frame('fg-grid', { name: 'Layout grid', layout: 'vertical', gap: 8 }, [
    text('fg-grid-h', 'Layout grid', { fill: fg, fontFamily: fam, fontSize: 14, fontWeight: '600' }),
    frame('fg-grid-demo', { name: 'columns', layout: 'horizontal', gap: ctx.token(gs.gutterKey), width: GRID_DEMO_WIDTH }, columns),
    text('fg-grid-meta', `${gs.columns} columns · gutter / margin / max bound to $grid.*`, {
      fill: muted,
      fontFamily: monoFam,
      fontSize: 11,
    }),
  ]);

  return [
    frame(
      'foundation-grids',
      {
        name: 'Foundations / Grids & Spacing',
        width: 920,
        fill: ctx.token('color.background'),
        layout: 'vertical',
        gap: 28,
        padding: 40,
      },
      [header, spacing, grid],
    ),
  ];
}

export function gridsFoundation(): FoundationSpec {
  return {
    slug: 'grids',
    name: 'Foundations / Grids & Spacing',
    build: (ctx) => buildGridsPage(ctx, HEROUI_GRID),
  };
}
