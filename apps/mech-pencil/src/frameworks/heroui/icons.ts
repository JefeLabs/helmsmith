/**
 * HeroUI icon foundation — the `icons` DECISION page.
 *
 * `HEROUI_ICONS` is the data (lucide family · the `$icon.*` size scale ·
 * a semantic role→glyph map). `iconsFoundation()` emits it as a token-bound
 * Pencil page: a size-scale strip (each glyph sized by a `$icon.*` token) and
 * a grouped semantic grid (each glyph tinted by a `$color.*` token). Because
 * the page references the same scalars a component would, the foundation and
 * the catalog stay in lockstep — change `icon.md` once, both move.
 */

import type { IconFoundation } from '../../design-system/icons.ts';
import { frame, icon, text } from '../../pen/builder.ts';
import type { Child } from '../../pen/schema.ts';
import type { FoundationSpec, MockupContext } from '../_core/adapter.ts';

/** lucide glyph names (matches `icon()`'s `iconFontFamily: 'lucide'`). */
export const HEROUI_ICONS: IconFoundation = {
  family: 'lucide',
  sizeKeys: ['icon.xs', 'icon.sm', 'icon.md', 'icon.lg', 'icon.xl', 'icon.2xl'],
  semantic: [
    { group: 'Actions', role: 'add', icon: 'plus' },
    { group: 'Actions', role: 'edit', icon: 'pencil' },
    { group: 'Actions', role: 'delete', icon: 'trash-2' },
    { group: 'Actions', role: 'duplicate', icon: 'copy' },
    { group: 'Actions', role: 'save', icon: 'save' },
    { group: 'Actions', role: 'search', icon: 'search' },
    { group: 'Actions', role: 'filter', icon: 'filter' },
    { group: 'Actions', role: 'settings', icon: 'settings' },
    { group: 'Actions', role: 'download', icon: 'download' },
    { group: 'Actions', role: 'upload', icon: 'upload' },
    { group: 'Actions', role: 'share', icon: 'share-2' },
    { group: 'Navigation', role: 'menu', icon: 'menu' },
    { group: 'Navigation', role: 'close', icon: 'x' },
    { group: 'Navigation', role: 'back', icon: 'chevron-left' },
    { group: 'Navigation', role: 'forward', icon: 'chevron-right' },
    { group: 'Navigation', role: 'expand', icon: 'chevron-down' },
    { group: 'Navigation', role: 'collapse', icon: 'chevron-up' },
    { group: 'Navigation', role: 'external', icon: 'external-link' },
    { group: 'Navigation', role: 'more', icon: 'ellipsis' },
    { group: 'Status', role: 'info', icon: 'info' },
    { group: 'Status', role: 'success', icon: 'circle-check' },
    { group: 'Status', role: 'warning', icon: 'triangle-alert' },
    { group: 'Status', role: 'danger', icon: 'octagon-alert' },
    { group: 'Status', role: 'help', icon: 'circle-help' },
  ],
};

/** Semantic group → tint token (Status maps to status colors; rest neutral). */
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

/** Build the icons foundation page from `HEROUI_ICONS`, token-bound. */
function buildIconsPage(ctx: MockupContext): Child[] {
  let seq = 0;
  const nid = (p: string) => `fi-${p}-${seq++}`;
  const fg = ctx.token('color.foreground');
  const muted = ctx.token('color.muted');
  const fam = ctx.token('font.family');

  const header = frame('fi-header', { name: 'Header', layout: 'vertical', gap: 4 }, [
    text('fi-title', 'Icons', { fill: fg, fontFamily: fam, fontSize: 28, fontWeight: '700' }),
    text('fi-sub', `${HEROUI_ICONS.family} · ${HEROUI_ICONS.sizeKeys.length} sizes · ${HEROUI_ICONS.semantic.length} semantic roles`, {
      fill: muted,
      fontFamily: fam,
      fontSize: 14,
    }),
  ]);

  // Size scale — one representative glyph at each $icon.* token size.
  const sizeCells = HEROUI_ICONS.sizeKeys.map((key) =>
    frame(nid('size'), { name: key, layout: 'vertical', gap: 6, alignItems: 'center', width: CELL }, [
      icon(nid('sizeglyph'), 'star', {
        width: ctx.token(key),
        height: ctx.token(key),
        fill: fg,
      }),
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
          icon(nid('glyph'), e.icon, {
            width: ctx.token('icon.lg'),
            height: ctx.token('icon.lg'),
            fill: ctx.token(STATUS_TINT[e.role] ?? 'color.foreground'),
          }),
          text(nid('role'), e.role, { fill: fg, fontFamily: fam, fontSize: 11 }),
          text(nid('glyphname'), e.icon, { fill: muted, fontFamily: fam, fontSize: 9 }),
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
        theme: { mode: 'light' },
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
