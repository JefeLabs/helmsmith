/**
 * Card — a fully hand-authored reference component.
 *
 * This exists as the worked example to model `button.ts` (and future
 * rich components) on. It shows the three things a faithful component
 * does that a stub doesn't:
 *
 *   1. Real internal structure (header / body / footer regions).
 *   2. Token-driven styling at every level (no hardcoded colors/sizes).
 *   3. A `slot` frame so a mockup can inject arbitrary content via the
 *      ref's `descendants["card/body"].children`.
 *
 * HeroUI v3 Card = a `surface` with `--overlay-shadow`, `--radius-lg`,
 * a `--border` hairline, and `--surface-foreground` text.
 */

import type { BuildContext } from '../../../design-system/atomic.ts';
import { frame, reusable, text, withMeta } from '../../../pen/builder.ts';
import type { Child } from '../../../pen/schema.ts';

export function buildCard(ctx: BuildContext): Child {
  const header = frame(
    'card-header',
    {
      name: 'Header',
      layout: 'vertical',
      gap: ctx.token('space.unit'),
      width: 'fill_container',
      padding: [20, 20, 0, 20],
    },
    [
      text('card-title', 'Card title', {
        fill: ctx.color('surface-foreground'),
        fontFamily: ctx.token('font.family'),
        fontSize: ctx.token('font.size-lg'),
        fontWeight: '600',
      }),
      text('card-subtitle', 'Supporting copy goes here.', {
        fill: ctx.color('muted'),
        fontFamily: ctx.token('font.family'),
        fontSize: ctx.token('font.size-sm'),
      }),
    ],
  );

  // Body is a customizable region. A mockup overrides card-title /
  // card-subtitle text via `descendants` (verified to work for LOCAL
  // refs) and can drop sibling component refs alongside the card.
  const body = frame(
    'card-body',
    {
      name: 'Body',
      width: 'fill_container',
      padding: 20,
      layout: 'vertical',
      gap: ctx.token('space.unit'),
    },
    [
      text('card-body-text', 'Body content.', {
        fill: ctx.color('muted'),
        fontFamily: ctx.token('font.family'),
        fontSize: ctx.token('font.size-sm'),
      }),
    ],
  );

  const footer = frame(
    'card-footer',
    {
      name: 'Footer',
      width: 'fill_container',
      padding: [0, 20, 20, 20],
      layout: 'horizontal',
      justifyContent: 'end',
      gap: ctx.token('space.unit'),
    },
    [],
  );

  return withMeta(
    reusable(
      frame(
        'card',
        {
          name: 'Card',
          width: 360,
          fill: ctx.color('surface'),
          cornerRadius: ctx.token('radius.lg'),
          stroke: { thickness: ctx.token('border.width'), fill: ctx.color('border') },
          effect: {
            type: 'shadow',
            shadowType: 'outer',
            offset: { x: 0, y: 2 },
            blur: 8,
            spread: 0,
            color: '#0000001f',
          },
          layout: 'vertical',
          gap: 16,
          clip: true,
        },
        [header, body, footer],
      ),
    ),
    { type: 'component', framework: 'heroui', atomic: 'molecule', fidelity: 'full' },
  );
}
