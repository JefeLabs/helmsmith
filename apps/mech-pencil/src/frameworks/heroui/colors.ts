/**
 * HeroUI colors foundation — the `colors` DECISION page.
 *
 * A swatch grid of the semantic color tokens, grouped. Each swatch fills from
 * `$colors:color.<name>` (themed light/dark in colors.lib.pen); labels use the
 * typography foundation's families — so the page imports colors + type, which
 * is exactly the multi-alias wiring option A is built on.
 */

import { frame, rect, text } from '../../pen/builder.ts';
import type { Child } from '../../pen/schema.ts';
import type { FoundationSpec, MockupContext } from '../_core/adapter.ts';

const GROUPS: { title: string; names: string[] }[] = [
  { title: 'Brand', names: ['accent', 'accent-foreground'] },
  { title: 'Status', names: ['success', 'warning', 'danger'] },
  { title: 'Surfaces', names: ['background', 'surface', 'surface-secondary', 'muted'] },
  { title: 'Lines', names: ['border', 'separator', 'focus'] },
];

function buildColorsPage(ctx: MockupContext): Child[] {
  let seq = 0;
  const nid = (p: string) => `fc-${p}-${seq++}`;
  const fg = ctx.token('color.foreground');
  const muted = ctx.token('color.muted');
  const fam = ctx.token('font.family');
  const monoFam = ctx.token('font.mono');

  const header = frame('fc-header', { name: 'Header', layout: 'vertical', gap: 4 }, [
    text('fc-title', 'Colors', { fill: fg, fontFamily: ctx.token('font.display'), fontSize: 28, fontWeight: '700' }),
    text('fc-sub', 'semantic color tokens · themed light + dark', { fill: muted, fontFamily: monoFam, fontSize: 14 }),
  ]);

  const groups = GROUPS.map((g) =>
    frame(nid('group'), { name: g.title, layout: 'vertical', gap: 8 }, [
      text(nid('gh'), g.title, { fill: fg, fontFamily: fam, fontSize: 14, fontWeight: '600' }),
      frame(nid('row'), { name: 'row', layout: 'horizontal', gap: 12 }, g.names.map((name) =>
        frame(nid('cell'), { name, layout: 'vertical', gap: 6, width: 120 }, [
          rect(nid('sw'), {
            width: 120,
            height: 56,
            cornerRadius: 8,
            fill: ctx.token(`color.${name}`),
            stroke: { thickness: 1, fill: ctx.token('color.border') },
          }),
          text(nid('label'), name, { fill: muted, fontFamily: monoFam, fontSize: 10 }),
        ]),
      )),
    ]),
  );

  return [
    frame(
      'foundation-colors',
      {
        name: 'Foundations / Colors',
        width: 760,
        fill: ctx.token('color.background'),
        layout: 'vertical',
        gap: 24,
        padding: 40,
      },
      [header, ...groups],
    ),
  ];
}

export function colorsFoundation(): FoundationSpec {
  return { slug: 'colors', name: 'Foundations / Colors', build: buildColorsPage };
}
