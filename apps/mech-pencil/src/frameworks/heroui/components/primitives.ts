/**
 * Curated rich HeroUI v3 components.
 *
 * Same conventions as button.ts / card.ts: every value comes from a
 * design token (so light/dark reskin), ids are slugged (no `/`), flex
 * layout with fit_content/fill_container, text always has a `fill`.
 * Each returns one `reusable` node tagged via withMeta.
 *
 * Registered in catalog.ts `RICH`; together with button + card these
 * are the ~12 fully-authored components, the rest stay token stubs.
 */

import type { BuildContext } from '../../../design-system/atomic.ts';
import { frame, reusable, text, withMeta } from '../../../pen/builder.ts';
import type { Child } from '../../../pen/schema.ts';

export const FULL = 9999; // cornerRadius for pills/circles

export function comp<T extends Child>(node: T, atomic: string): T {
  return withMeta(reusable(node), {
    type: 'component',
    framework: 'heroui',
    atomic,
    fidelity: 'full',
  });
}

export function buildInput(ctx: BuildContext): Child {
  return comp(
    frame(
      'input',
      {
        name: 'Input',
        width: 280,
        height: 40,
        layout: 'horizontal',
        alignItems: 'center',
        padding: [12, 0],
        fill: ctx.color('field-background'),
        cornerRadius: ctx.token('radius.md'),
        stroke: { thickness: ctx.token('border.width'), fill: ctx.color('border') },
      },
      [
        text('input-text', 'Placeholder', {
          fill: ctx.color('field-placeholder'),
          fontFamily: ctx.token('font.family'),
          fontSize: ctx.token('font.size-md'),
        }),
      ],
    ),
    'atom',
  );
}

export function buildBadge(ctx: BuildContext): Child {
  return comp(
    frame(
      'badge',
      {
        name: 'Badge',
        layout: 'horizontal',
        width: 'fit_content',
        alignItems: 'center',
        justifyContent: 'center',
        padding: [8, 3],
        fill: ctx.color('accent'),
        cornerRadius: FULL,
      },
      [
        text('badge-label', 'New', {
          fill: ctx.color('accent-foreground'),
          fontFamily: ctx.token('font.family'),
          fontSize: 12,
          fontWeight: '600',
        }),
      ],
    ),
    'atom',
  );
}

export function buildChip(ctx: BuildContext): Child {
  return comp(
    frame(
      'chip',
      {
        name: 'Chip',
        layout: 'horizontal',
        width: 'fit_content',
        alignItems: 'center',
        gap: ctx.token('space.unit'),
        padding: [12, 6],
        fill: ctx.color('accent-soft'),
        cornerRadius: FULL,
      },
      [
        text('chip-label', 'Chip', {
          fill: ctx.color('accent'),
          fontFamily: ctx.token('font.family'),
          fontSize: ctx.token('font.size-sm'),
          fontWeight: '500',
        }),
      ],
    ),
    'atom',
  );
}

export function buildAvatar(ctx: BuildContext): Child {
  return comp(
    frame(
      'avatar',
      {
        name: 'Avatar',
        width: 40,
        height: 40,
        layout: 'horizontal',
        alignItems: 'center',
        justifyContent: 'center',
        fill: ctx.color('accent'),
        cornerRadius: FULL,
      },
      [
        text('avatar-initials', 'AB', {
          fill: ctx.color('accent-foreground'),
          fontFamily: ctx.token('font.family'),
          fontSize: 14,
          fontWeight: '600',
        }),
      ],
    ),
    'atom',
  );
}

export function buildSwitch(ctx: BuildContext): Child {
  return comp(
    frame(
      'switch',
      {
        name: 'Switch',
        width: 44,
        height: 24,
        layout: 'horizontal',
        alignItems: 'center',
        justifyContent: 'end',
        padding: [2, 2],
        fill: ctx.color('accent'),
        cornerRadius: FULL,
      },
      [
        frame('switch-knob', {
          name: 'Knob',
          width: 20,
          height: 20,
          fill: ctx.color('surface'),
          cornerRadius: FULL,
        }),
      ],
    ),
    'atom',
  );
}

export function buildCheckbox(ctx: BuildContext): Child {
  return comp(
    frame(
      'checkbox',
      {
        name: 'Checkbox',
        width: 20,
        height: 20,
        layout: 'horizontal',
        alignItems: 'center',
        justifyContent: 'center',
        fill: ctx.color('accent'),
        cornerRadius: ctx.token('radius.sm'),
      },
      [
        text('checkbox-check', '✓', {
          fill: ctx.color('accent-foreground'),
          fontFamily: ctx.token('font.family'),
          fontSize: 14,
          fontWeight: '700',
        }),
      ],
    ),
    'atom',
  );
}

export function buildAlert(ctx: BuildContext): Child {
  return comp(
    frame(
      'alert',
      {
        name: 'Alert',
        width: 380,
        layout: 'horizontal',
        alignItems: 'start',
        gap: 12,
        padding: 16,
        fill: ctx.color('accent-soft'),
        cornerRadius: ctx.token('radius.md'),
      },
      [
        frame('alert-dot', {
          name: 'Dot',
          width: 10,
          height: 10,
          fill: ctx.color('accent'),
          cornerRadius: FULL,
        }),
        frame(
          'alert-content',
          { name: 'Content', layout: 'vertical', width: 'fill_container', gap: 4 },
          [
            text('alert-title', 'Heads up', {
              fill: ctx.color('foreground'),
              fontFamily: ctx.token('font.family'),
              fontSize: ctx.token('font.size-md'),
              fontWeight: '600',
            }),
            text('alert-body', 'Something needs your attention.', {
              fill: ctx.color('muted'),
              fontFamily: ctx.token('font.family'),
              fontSize: ctx.token('font.size-sm'),
              textGrowth: 'fixed-width',
              width: 'fill_container',
            }),
          ],
        ),
      ],
    ),
    'molecule',
  );
}

export function buildTabs(ctx: BuildContext): Child {
  const tab = (i: number, label: string, active: boolean): Child =>
    frame(
      `tabs-tab-${i}`,
      {
        name: label,
        layout: 'horizontal',
        alignItems: 'center',
        justifyContent: 'center',
        padding: [16, 8],
        fill: active ? ctx.color('accent-soft') : ctx.color('surface'),
        cornerRadius: ctx.token('radius.sm'),
      },
      [
        text(`tabs-tab-${i}-label`, label, {
          fill: active ? ctx.color('accent') : ctx.color('muted'),
          fontFamily: ctx.token('font.family'),
          fontSize: ctx.token('font.size-sm'),
          fontWeight: active ? '600' : '500',
        }),
      ],
    );
  return comp(
    frame(
      'tabs',
      {
        name: 'Tabs',
        layout: 'horizontal',
        width: 'fit_content',
        gap: 4,
        padding: 4,
        fill: ctx.color('surface'),
        cornerRadius: ctx.token('radius.md'),
        stroke: { thickness: ctx.token('border.width'), fill: ctx.color('border') },
      },
      [tab(0, 'Overview', true), tab(1, 'Activity', false), tab(2, 'Settings', false)],
    ),
    'molecule',
  );
}

export function buildTooltip(ctx: BuildContext): Child {
  return comp(
    frame(
      'tooltip',
      {
        name: 'Tooltip',
        layout: 'horizontal',
        width: 'fit_content',
        alignItems: 'center',
        padding: [10, 6],
        fill: ctx.color('foreground'),
        cornerRadius: ctx.token('radius.sm'),
      },
      [
        text('tooltip-label', 'Tooltip', {
          fill: ctx.color('background'),
          fontFamily: ctx.token('font.family'),
          fontSize: ctx.token('font.size-sm'),
        }),
      ],
    ),
    'molecule',
  );
}

export function buildPagination(ctx: BuildContext): Child {
  const pageNode = (i: number, active: boolean): Child =>
    frame(
      `pagination-page-${i}`,
      {
        name: `Page ${i + 1}`,
        width: 32,
        height: 32,
        layout: 'horizontal',
        alignItems: 'center',
        justifyContent: 'center',
        fill: active ? ctx.color('accent') : ctx.color('surface'),
        cornerRadius: ctx.token('radius.md'),
        stroke: active
          ? undefined
          : { thickness: ctx.token('border.width'), fill: ctx.color('border') },
      },
      [
        text(`pagination-page-${i}-label`, String(i + 1), {
          fill: active ? ctx.color('accent-foreground') : ctx.color('foreground'),
          fontFamily: ctx.token('font.family'),
          fontSize: ctx.token('font.size-sm'),
          fontWeight: active ? '600' : '500',
        }),
      ],
    );
  return comp(
    frame(
      'pagination',
      { name: 'Pagination', layout: 'horizontal', width: 'fit_content', gap: 8 },
      [0, 1, 2, 3, 4].map((i) => pageNode(i, i === 0)),
    ),
    'molecule',
  );
}
