/**
 * HeroUI icon foundation — the `icons` DECISION page.
 *
 * Icons are emitted as `path` nodes from Font Awesome glyph geometry
 * (`fa-icons.ts`), so they render headlessly (vector, no icon font) AND match
 * the brand's Font Awesome set. Free-solid geometry today; swap to FA Pro
 * Sharp-Solid via the same `path` mechanism when the Pro kit is available.
 * Sizes bind `$icon.*`, tints bind `$color.*` — same lockstep as the others.
 */

import type { IconFoundation } from '../../design-system/icons.ts';
import { frame, text } from '../../pen/builder.ts';
import type { Child } from '../../pen/schema.ts';
import type { FoundationSpec, MockupContext } from '../_core/adapter.ts';
import { faIconNode } from './fa-icons.ts';

/** Semantic role → Font Awesome glyph name (keys exist in FA_GLYPHS). */
export const HEROUI_ICONS: IconFoundation = {
  family: 'fontawesome',
  sizeKeys: ['icon.xs', 'icon.sm', 'icon.md', 'icon.lg', 'icon.xl', 'icon.2xl'],
  semantic: [
    { group: 'Actions', role: 'add', icon: 'plus' },
    { group: 'Actions', role: 'edit', icon: 'pen-to-square' },
    { group: 'Actions', role: 'delete', icon: 'trash-can' },
    { group: 'Actions', role: 'duplicate', icon: 'copy' },
    { group: 'Actions', role: 'save', icon: 'floppy-disk' },
    { group: 'Actions', role: 'search', icon: 'magnifying-glass' },
    { group: 'Actions', role: 'filter', icon: 'filter' },
    { group: 'Actions', role: 'settings', icon: 'gear' },
    { group: 'Actions', role: 'download', icon: 'download' },
    { group: 'Actions', role: 'upload', icon: 'upload' },
    { group: 'Actions', role: 'share', icon: 'share-nodes' },
    { group: 'Navigation', role: 'menu', icon: 'bars' },
    { group: 'Navigation', role: 'close', icon: 'xmark' },
    { group: 'Navigation', role: 'back', icon: 'chevron-left' },
    { group: 'Navigation', role: 'forward', icon: 'chevron-right' },
    { group: 'Navigation', role: 'expand', icon: 'chevron-down' },
    { group: 'Navigation', role: 'collapse', icon: 'chevron-up' },
    { group: 'Navigation', role: 'external', icon: 'arrow-up-right-from-square' },
    { group: 'Navigation', role: 'more', icon: 'ellipsis' },
    { group: 'Status', role: 'info', icon: 'circle-info' },
    { group: 'Status', role: 'success', icon: 'circle-check' },
    { group: 'Status', role: 'warning', icon: 'triangle-exclamation' },
    { group: 'Status', role: 'danger', icon: 'circle-exclamation' },
    { group: 'Status', role: 'help', icon: 'circle-question' },
    { group: 'Domain', role: 'agent', icon: 'robot' },
    { group: 'Domain', role: 'job', icon: 'list-check' },
    { group: 'Domain', role: 'session', icon: 'terminal' },
    { group: 'Domain', role: 'run', icon: 'play' },
    { group: 'Domain', role: 'benchmark', icon: 'gauge-high' },
    { group: 'Domain', role: 'diff', icon: 'code-compare' },
  ],
};

// path width/height must be LITERAL px — a $token ref on a path's size renders
// 0 (verified). The icon scale still lives in tokens (code-gen); the .pen bakes
// the px from it. Mirrors the icon.* SCALAR values in tokens.ts.
const ICON_PX: Record<string, number> = {
  'icon.xs': 12, 'icon.sm': 16, 'icon.md': 20, 'icon.lg': 24, 'icon.xl': 32, 'icon.2xl': 40,
};

const STATUS_TINT: Record<string, string> = {
  info: 'color.accent',
  success: 'color.success',
  warning: 'color.warning',
  danger: 'color.danger',
  help: 'color.muted',
};

const PER_ROW = 9;
const CELL = 92;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function buildIconsPage(ctx: MockupContext): Child[] {
  let seq = 0;
  const nid = (p: string) => `fi-${p}-${seq++}`;
  const fg = ctx.token('color.foreground');
  const muted = ctx.token('color.muted');
  const fam = ctx.token('font.family');

  const header = frame('fi-header', { name: 'Header', layout: 'vertical', gap: 4 }, [
    text('fi-title', 'Icons', { fill: fg, fontFamily: ctx.token('font.display'), fontSize: 28, fontWeight: '700' }),
    text('fi-sub', `Font Awesome · ${HEROUI_ICONS.sizeKeys.length} sizes · ${HEROUI_ICONS.semantic.length} semantic roles`, {
      fill: muted,
      fontFamily: ctx.token('font.mono'),
      fontSize: 14,
    }),
  ]);

  // Size scale — one representative glyph at each $icon.* token size.
  const sizeCells = HEROUI_ICONS.sizeKeys.map((key) =>
    frame(nid('size'), { name: key, layout: 'vertical', gap: 6, alignItems: 'center', width: CELL }, [
      faIconNode(nid('sizeglyph'), 'gear', ICON_PX[key] ?? 24, fg),
      text(nid('sizelabel'), key.replace('icon.', ''), { fill: muted, fontFamily: fam, fontSize: 11 }),
    ]),
  );
  const sizes = frame('fi-sizes', { name: 'Size scale', layout: 'vertical', gap: 10 }, [
    text('fi-sizes-h', 'Size scale', { fill: fg, fontFamily: fam, fontSize: 14, fontWeight: '600' }),
    frame('fi-sizes-row', { name: 'row', layout: 'horizontal', gap: 16, alignItems: 'end' }, sizeCells),
  ]);

  // Semantic grid — grouped role→glyph, tinted by $color.*.
  const groups = [...new Set(HEROUI_ICONS.semantic.map((e) => e.group ?? 'General'))];
  const sections: Child[] = [];
  for (const group of groups) {
    const entries = HEROUI_ICONS.semantic.filter((e) => (e.group ?? 'General') === group);
    const rows = chunk(entries, PER_ROW).map((row) =>
      frame(nid('semrow'), { name: 'row', layout: 'horizontal', gap: 8 }, row.map((e) =>
        frame(nid('cell'), { name: e.role, layout: 'vertical', gap: 5, alignItems: 'center', width: CELL }, [
          faIconNode(nid('glyph'), e.icon, ICON_PX['icon.lg'], ctx.token(STATUS_TINT[e.role] ?? 'color.foreground')),
          text(nid('role'), e.role, { fill: fg, fontFamily: fam, fontSize: 11 }),
          text(nid('glyphname'), e.icon, { fill: muted, fontFamily: ctx.token('font.mono'), fontSize: 9 }),
        ]),
      )),
    );
    sections.push(
      frame(nid('group'), { name: group, layout: 'vertical', gap: 10 }, [
        text(nid('grouph'), group, { fill: fg, fontFamily: fam, fontSize: 14, fontWeight: '600' }),
        ...rows,
      ]),
    );
  }
  const semantic = frame('fi-semantic', { name: 'Semantic', layout: 'vertical', gap: 20 }, sections);

  return [
    frame(
      'foundation-icons',
      {
        name: 'Foundations / Icons',
        width: 1040,
        fill: ctx.token('color.background'),
        layout: 'vertical',
        gap: 28,
        padding: 40,
      },
      [header, sizes, semantic],
    ),
  ];
}

export function iconsFoundation(): FoundationSpec {
  return { slug: 'icons', name: 'Foundations / Icons', build: buildIconsPage };
}
