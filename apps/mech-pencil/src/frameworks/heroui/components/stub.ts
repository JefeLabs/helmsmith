/**
 * Generic token-driven component stub.
 *
 * The full HeroUI v3 catalog is ~72 components. The high-value ones
 * get hand-authored builders (see catalog.ts `RICH`); the long tail
 * uses this stub so the library is *complete* and every component is a
 * real, themed, reusable node.
 *
 * The stub is a polished placeholder card — accent stripe, the
 * component name, and a soft "type" chip — so the palette reads as a
 * structured design system rather than a column of empty boxes. It
 * consumes only design tokens, so all stubs reskin light/dark.
 */

import type { BuildContext } from '../../../design-system/atomic.ts';
import { frame, reusable, text, withMeta } from '../../../pen/builder.ts';
import type { Child } from '../../../pen/schema.ts';

export function buildStub(
  id: string,
  name: string,
  level: string,
  ctx: BuildContext,
): Child {
  const stripe = frame(`${id}-stripe`, {
    name: 'Stripe',
    width: 'fill_container',
    height: 4,
    fill: ctx.color('accent'),
  });

  const chip = frame(
    `${id}-chip`,
    {
      name: 'Type',
      layout: 'horizontal',
      width: 'fit_content',
      fill: ctx.color('accent-soft'),
      cornerRadius: ctx.token('radius.sm'),
      padding: [8, 3],
    },
    [
      text(`${id}-chip-label`, level, {
        fill: ctx.color('accent'),
        fontFamily: ctx.token('font.family'),
        fontSize: 12,
        fontWeight: '600',
      }),
    ],
  );

  const body = frame(
    `${id}-body`,
    {
      name: 'Body',
      layout: 'vertical',
      width: 'fill_container',
      gap: 8,
      padding: 16,
    },
    [
      text(`${id}-name`, name, {
        fill: ctx.color('surface-foreground'),
        fontFamily: ctx.token('font.family'),
        fontSize: ctx.token('font.size-md'),
        fontWeight: '600',
      }),
      chip,
      text(`${id}-desc`, 'HeroUI v3 component', {
        fill: ctx.color('muted'),
        fontFamily: ctx.token('font.family'),
        fontSize: ctx.token('font.size-sm'),
      }),
    ],
  );

  return withMeta(
    reusable(
      frame(
        id,
        {
          name,
          width: 280,
          fill: ctx.color('surface'),
          cornerRadius: ctx.token('radius.lg'),
          stroke: { thickness: ctx.token('border.width'), fill: ctx.color('border') },
          layout: 'vertical',
          gap: 0,
          clip: true,
        },
        [stripe, body],
      ),
    ),
    { type: 'component', framework: 'heroui', atomic: level, fidelity: 'stub' },
  );
}
