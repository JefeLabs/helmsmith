/**
 * High-fidelity HeroUI v3 organisms (batch 3): the 20 composed
 * components — forms, data display, navigation, overlays. Token-driven,
 * slugged ids, flex layout. Shared mini-builders keep each compact.
 */

import type { BuildContext } from '../../../design-system/atomic.ts';
import { frame, text } from '../../../pen/builder.ts';
import type { Child } from '../../../pen/schema.ts';
import { FULL, comp } from './primitives.ts';

const P = (ctx: BuildContext) => ({
  fg: ctx.color('foreground'),
  mut: ctx.color('muted'),
  acc: ctx.color('accent'),
  accFg: ctx.color('accent-foreground'),
  soft: ctx.color('accent-soft'),
  surf: ctx.color('surface'),
  bg: ctx.color('background'),
  bd: ctx.color('border'),
  fbg: ctx.color('field-background'),
  fph: ctx.color('field-placeholder'),
  ff: ctx.token('font.family'),
  fs: ctx.token('font.size-sm'),
  fm: ctx.token('font.size-md'),
  fl: ctx.token('font.size-lg'),
  rsm: ctx.token('radius.sm'),
  rmd: ctx.token('radius.md'),
  rlg: ctx.token('radius.lg'),
  bw: ctx.token('border.width'),
});

type T = ReturnType<typeof P>;
const SHADOW = { type: 'shadow' as const, shadowType: 'outer' as const, offset: { x: 0, y: 8 }, blur: 24, spread: 0, color: '#00000026' };

const btn = (id: string, s: string, p: T, primary: boolean): Child =>
  frame(id, { name: s, layout: 'horizontal', width: 'fit_content', alignItems: 'center', justifyContent: 'center', padding: [16, 10], cornerRadius: p.rmd, fill: primary ? p.acc : p.surf, stroke: primary ? undefined : { thickness: p.bw, fill: p.bd } }, [
    text(`${id}-l`, s, { fill: primary ? p.accFg : p.fg, fontFamily: p.ff, fontSize: p.fm, fontWeight: '600' }),
  ]);

const fld = (id: string, p: T, value: string, ph = true): Child =>
  frame(id, { name: 'Field', width: 'fill_container', height: 40, layout: 'horizontal', alignItems: 'center', justifyContent: 'space_between', padding: [12, 0], cornerRadius: p.rmd, fill: p.fbg, stroke: { thickness: p.bw, fill: p.bd } }, [
    text(`${id}-v`, value, { fill: ph ? p.fph : p.fg, fontFamily: p.ff, fontSize: p.fm }),
    text(`${id}-c`, '▾', { fill: p.mut, fontFamily: p.ff, fontSize: p.fm }),
  ]);

const menu = (id: string, p: T, items: string[], selected: number): Child =>
  frame(id, { name: 'Menu', width: 260, layout: 'vertical', padding: 6, fill: p.surf, cornerRadius: p.rmd, stroke: { thickness: p.bw, fill: p.bd }, effect: SHADOW }, items.map((it, i) =>
    frame(`${id}-${i}`, { name: it, layout: 'horizontal', width: 'fill_container', alignItems: 'center', padding: [10, 8], cornerRadius: p.rsm, fill: i === selected ? p.soft : 'transparent' }, [
      text(`${id}-${i}-l`, it, { fill: i === selected ? p.acc : p.fg, fontFamily: p.ff, fontSize: p.fm, fontWeight: i === selected ? '600' : '400' }),
    ]),
  ));

export function buildForm(ctx: BuildContext): Child {
  const p = P(ctx);
  const grp = (id: string, lbl: string, val: string) =>
    frame(id, { layout: 'vertical', width: 'fill_container', gap: 6 }, [
      text(`${id}-lab`, lbl, { fill: p.fg, fontFamily: p.ff, fontSize: p.fs, fontWeight: '600' }),
      frame(`${id}-in`, { width: 'fill_container', height: 40, layout: 'horizontal', alignItems: 'center', padding: [12, 0], cornerRadius: p.rmd, fill: p.fbg, stroke: { thickness: p.bw, fill: p.bd } }, [text(`${id}-in-t`, val, { fill: p.fph, fontFamily: p.ff, fontSize: p.fm })]),
    ]);
  return comp(
    frame('form', { name: 'Form', width: 360, layout: 'vertical', gap: 16 }, [
      grp('form-name', 'Full name', 'Ada Lovelace'),
      grp('form-email', 'Email', 'ada@example.com'),
      frame('form-actions', { layout: 'horizontal', width: 'fill_container', justifyContent: 'end', gap: 12 }, [btn('form-cancel', 'Cancel', p, false), btn('form-submit', 'Submit', p, true)]),
    ]),
    'organism',
  );
}

export function buildTable(ctx: BuildContext): Child {
  const p = P(ctx);
  const cell = (id: string, s: string, head: boolean) =>
    frame(id, { name: 'Cell', width: 'fill_container', layout: 'horizontal', alignItems: 'center', padding: [16, 12] }, [
      text(`${id}-t`, s, { fill: head ? p.mut : p.fg, fontFamily: p.ff, fontSize: head ? p.fs : p.fm, fontWeight: head ? '600' : '400' }),
    ]);
  const row = (id: string, cells: string[], head: boolean) =>
    frame(id, { name: head ? 'Header' : 'Row', layout: 'horizontal', width: 'fill_container', fill: head ? p.soft : p.surf, stroke: { thickness: { bottom: p.bw }, fill: p.bd } }, cells.map((cv, i) => cell(`${id}-c${i}`, cv, head)));
  return comp(
    frame('table', { name: 'Table', width: 520, layout: 'vertical', cornerRadius: p.rlg, stroke: { thickness: p.bw, fill: p.bd }, clip: true }, [
      row('table-h', ['Name', 'Email', 'Role'], true),
      row('table-r0', ['Ada Lovelace', 'ada@ex.com', 'Owner'], false),
      row('table-r1', ['Alan Turing', 'alan@ex.com', 'Admin'], false),
      row('table-r2', ['Grace Hopper', 'grace@ex.com', 'Member'], false),
    ]),
    'organism',
  );
}

export function buildListBox(ctx: BuildContext): Child {
  const p = P(ctx);
  return comp(
    frame('list-box', { name: 'ListBox', width: 260, layout: 'vertical', padding: 6, fill: p.surf, cornerRadius: p.rmd, stroke: { thickness: p.bw, fill: p.bd } }, ['Profile', 'Billing', 'Team', 'Settings'].map((it, i) =>
      frame(`list-box-${i}`, { name: it, layout: 'horizontal', width: 'fill_container', alignItems: 'center', padding: [10, 8], cornerRadius: p.rsm, fill: i === 1 ? p.soft : 'transparent' }, [
        text(`list-box-${i}-l`, it, { fill: i === 1 ? p.acc : p.fg, fontFamily: p.ff, fontSize: p.fm, fontWeight: i === 1 ? '600' : '400' }),
      ]),
    )),
    'organism',
  );
}

export function buildDropdown(ctx: BuildContext): Child {
  const p = P(ctx);
  return comp(
    frame('dropdown', { name: 'Dropdown', width: 260, layout: 'vertical', gap: 8 }, [
      btn('dropdown-trigger', 'Actions  ▾', p, false),
      menu('dropdown-menu', p, ['Edit', 'Duplicate', 'Archive', 'Delete'], -1),
    ]),
    'organism',
  );
}

function accordionItem(prefix: string, i: number, title: string, p: T, open: boolean): Child {
  return frame(`${prefix}-${i}`, { name: title, layout: 'vertical', width: 'fill_container', stroke: { thickness: { bottom: p.bw }, fill: p.bd } }, [
    frame(`${prefix}-${i}-h`, { layout: 'horizontal', width: 'fill_container', alignItems: 'center', justifyContent: 'space_between', padding: 16 }, [
      text(`${prefix}-${i}-t`, title, { fill: p.fg, fontFamily: p.ff, fontSize: p.fm, fontWeight: '600' }),
      text(`${prefix}-${i}-c`, open ? '▾' : '▸', { fill: p.mut, fontFamily: p.ff, fontSize: p.fm }),
    ]),
    ...(open
      ? [frame(`${prefix}-${i}-b`, { layout: 'vertical', width: 'fill_container', padding: [16, 0, 16, 16] }, [text(`${prefix}-${i}-bt`, 'Details for this section live here.', { fill: p.mut, fontFamily: p.ff, fontSize: p.fs, textGrowth: 'fixed-width', width: 'fill_container' })])]
      : []),
  ]);
}

export function buildAccordion(ctx: BuildContext): Child {
  const p = P(ctx);
  return comp(
    frame('accordion', { name: 'Accordion', width: 360, layout: 'vertical', cornerRadius: p.rmd, stroke: { thickness: p.bw, fill: p.bd }, clip: true }, [
      accordionItem('accordion', 0, 'Overview', p, true),
      accordionItem('accordion', 1, 'Pricing', p, false),
      accordionItem('accordion', 2, 'FAQ', p, false),
    ]),
    'organism',
  );
}

export function buildDisclosureGroup(ctx: BuildContext): Child {
  const p = P(ctx);
  return comp(
    frame('disclosure-group', { name: 'DisclosureGroup', width: 360, layout: 'vertical', gap: 12 }, [0, 1].map((i) =>
      frame(`disclosure-group-${i}`, { layout: 'vertical', width: 'fill_container', cornerRadius: p.rmd, stroke: { thickness: p.bw, fill: p.bd }, clip: true }, [
        frame(`disclosure-group-${i}-h`, { layout: 'horizontal', width: 'fill_container', alignItems: 'center', justifyContent: 'space_between', padding: 14, fill: p.surf }, [
          text(`disclosure-group-${i}-t`, i === 0 ? 'Account' : 'Security', { fill: p.fg, fontFamily: p.ff, fontSize: p.fm, fontWeight: '600' }),
          text(`disclosure-group-${i}-c`, i === 0 ? '▾' : '▸', { fill: p.mut, fontFamily: p.ff, fontSize: p.fm }),
        ]),
      ]),
    )),
    'organism',
  );
}

export function buildToolbar(ctx: BuildContext): Child {
  const p = P(ctx);
  const ic = (id: string, g: string) =>
    frame(id, { width: 32, height: 32, layout: 'horizontal', alignItems: 'center', justifyContent: 'center', cornerRadius: p.rsm, fill: 'transparent' }, [text(`${id}-g`, g, { fill: p.fg, fontFamily: p.ff, fontSize: p.fm })]);
  return comp(
    frame('toolbar', { name: 'Toolbar', layout: 'horizontal', width: 'fit_content', alignItems: 'center', gap: 4, padding: 6, fill: p.surf, cornerRadius: p.rmd, stroke: { thickness: p.bw, fill: p.bd } }, [
      ic('toolbar-b', 'B'), ic('toolbar-i', 'I'), ic('toolbar-u', 'U'),
      frame('toolbar-sep', { width: 1, height: 24, fill: p.bd }),
      ic('toolbar-l', '≣'), ic('toolbar-c', '≡'),
    ]),
    'organism',
  );
}

function calendarGrid(prefix: string, p: T, range: boolean): Child {
  const wk = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const head = frame(`${prefix}-head`, { layout: 'horizontal', width: 'fill_container', alignItems: 'center', justifyContent: 'space_between', padding: [4, 4] }, [
    text(`${prefix}-prev`, '‹', { fill: p.mut, fontFamily: p.ff, fontSize: p.fm }),
    text(`${prefix}-mon`, 'June 2026', { fill: p.fg, fontFamily: p.ff, fontSize: p.fm, fontWeight: '600' }),
    text(`${prefix}-next`, '›', { fill: p.mut, fontFamily: p.ff, fontSize: p.fm }),
  ]);
  const wkrow = frame(`${prefix}-wk`, { layout: 'horizontal', width: 'fill_container' }, wk.map((d, i) =>
    frame(`${prefix}-wk-${i}`, { width: 32, height: 28, layout: 'horizontal', alignItems: 'center', justifyContent: 'center' }, [text(`${prefix}-wk-${i}-t`, d, { fill: p.mut, fontFamily: p.ff, fontSize: 12, fontWeight: '600' })]),
  ));
  const rows = [0, 1, 2, 3, 4].map((r) =>
    frame(`${prefix}-r${r}`, { layout: 'horizontal', width: 'fill_container' }, [0, 1, 2, 3, 4, 5, 6].map((cI) => {
      const day = r * 7 + cI - 2;
      const inMonth = day >= 1 && day <= 30;
      const sel = !range && day === 14;
      const inRange = range && day >= 10 && day <= 16;
      return frame(`${prefix}-r${r}-${cI}`, { width: 32, height: 32, layout: 'horizontal', alignItems: 'center', justifyContent: 'center', cornerRadius: sel ? FULL : 0, fill: sel ? p.acc : inRange ? p.soft : 'transparent' }, [
        text(`${prefix}-r${r}-${cI}-t`, inMonth ? String(day) : '', { fill: sel ? p.accFg : inRange ? p.acc : inMonth ? p.fg : p.mut, fontFamily: p.ff, fontSize: p.fs }),
      ]);
    })),
  );
  return frame(`${prefix}-cal`, { name: 'Calendar', layout: 'vertical', width: 'fit_content', gap: 4, padding: 12, fill: p.surf, cornerRadius: p.rlg, stroke: { thickness: p.bw, fill: p.bd } }, [head, wkrow, ...rows]);
}

export function buildCalendar(ctx: BuildContext): Child {
  return comp(frame('calendar', { name: 'Calendar', layout: 'vertical', width: 'fit_content' }, [calendarGrid('calendar', P(ctx), false)]), 'organism');
}
export function buildRangeCalendar(ctx: BuildContext): Child {
  return comp(frame('range-calendar', { name: 'RangeCalendar', layout: 'vertical', width: 'fit_content' }, [calendarGrid('range-calendar', P(ctx), true)]), 'organism');
}

export function buildDatePicker(ctx: BuildContext): Child {
  const p = P(ctx);
  return comp(frame('date-picker', { name: 'DatePicker', width: 280, layout: 'vertical', gap: 8 }, [fld('date-picker-f', p, '14 / 06 / 2026', false), calendarGrid('date-picker', p, false)]), 'organism');
}

export function buildDateRangePicker(ctx: BuildContext): Child {
  const p = P(ctx);
  return comp(
    frame('date-range-picker', { name: 'DateRangePicker', width: 320, layout: 'vertical', gap: 8 }, [
      frame('date-range-picker-row', { layout: 'horizontal', width: 'fill_container', gap: 8 }, [fld('date-range-picker-s', p, 'Jun 10', false), fld('date-range-picker-e', p, 'Jun 16', false)]),
      calendarGrid('date-range-picker', p, true),
    ]),
    'organism',
  );
}

export function buildColorPicker(ctx: BuildContext): Child {
  const p = P(ctx);
  return comp(
    frame('color-picker', { name: 'ColorPicker', width: 240, layout: 'vertical', gap: 12, padding: 16, fill: p.surf, cornerRadius: p.rlg, stroke: { thickness: p.bw, fill: p.bd }, effect: SHADOW }, [
      frame('color-picker-area', { width: 'fill_container', height: 120, cornerRadius: p.rmd, fill: { type: 'gradient', gradientType: 'linear', rotation: 90, colors: [{ color: '#ffffff', position: 0 }, { color: p.acc, position: 1 }] } }),
      frame('color-picker-hue', { width: 'fill_container', height: 12, cornerRadius: FULL, fill: { type: 'gradient', gradientType: 'linear', rotation: 90, colors: [{ color: '#ff0000', position: 0 }, { color: '#00ff00', position: 0.5 }, { color: '#0000ff', position: 1 }] } }),
      frame('color-picker-row', { layout: 'horizontal', width: 'fill_container', alignItems: 'center', gap: 8 }, [
        frame('color-picker-sw', { width: 24, height: 24, cornerRadius: p.rsm, fill: p.acc }),
        text('color-picker-hex', '#3F5694', { fill: p.fg, fontFamily: p.ff, fontSize: p.fm }),
      ]),
    ]),
    'organism',
  );
}

export function buildAutocomplete(ctx: BuildContext): Child {
  const p = P(ctx);
  return comp(frame('autocomplete', { name: 'Autocomplete', width: 260, layout: 'vertical', gap: 8 }, [fld('autocomplete-f', p, 'Type to search…'), menu('autocomplete-m', p, ['Argentina', 'Australia', 'Austria'], 0)]), 'organism');
}
export function buildComboBox(ctx: BuildContext): Child {
  const p = P(ctx);
  return comp(frame('combo-box', { name: 'ComboBox', width: 260, layout: 'vertical', gap: 8 }, [fld('combo-box-f', p, 'Select a framework', false), menu('combo-box-m', p, ['React', 'Vue', 'Svelte', 'Solid'], 0)]), 'organism');
}
export function buildSelect(ctx: BuildContext): Child {
  const p = P(ctx);
  return comp(frame('select', { name: 'Select', width: 260, layout: 'vertical', gap: 8 }, [fld('select-f', p, 'Choose a plan', true), menu('select-m', p, ['Starter', 'Team', 'Enterprise'], 1)]), 'organism');
}

function dialog(id: string, p: T, title: string, body: string, w: number): Child {
  return frame(id, { name: title, width: w, layout: 'vertical', gap: 16, padding: 24, fill: p.surf, cornerRadius: p.rlg, stroke: { thickness: p.bw, fill: p.bd }, effect: SHADOW }, [
    frame(`${id}-hd`, { layout: 'horizontal', width: 'fill_container', alignItems: 'center', justifyContent: 'space_between' }, [
      text(`${id}-title`, title, { fill: p.fg, fontFamily: p.ff, fontSize: p.fl, fontWeight: '700' }),
      text(`${id}-x`, '✕', { fill: p.mut, fontFamily: p.ff, fontSize: p.fm }),
    ]),
    text(`${id}-body`, body, { fill: p.mut, fontFamily: p.ff, fontSize: p.fm, textGrowth: 'fixed-width', width: 'fill_container' }),
    frame(`${id}-ft`, { layout: 'horizontal', width: 'fill_container', justifyContent: 'end', gap: 12 }, [btn(`${id}-cancel`, 'Cancel', p, false), btn(`${id}-ok`, 'Confirm', p, true)]),
  ]);
}

export function buildModal(ctx: BuildContext): Child {
  return comp(dialog('modal', P(ctx), 'Modal title', 'Modal content explaining the action the user is about to take.', 480), 'organism');
}
export function buildAlertDialog(ctx: BuildContext): Child {
  return comp(dialog('alert-dialog', P(ctx), 'Delete project?', 'This action cannot be undone. This will permanently delete the project.', 420), 'organism');
}

export function buildDrawer(ctx: BuildContext): Child {
  const p = P(ctx);
  return comp(
    frame('drawer', { name: 'Drawer', width: 320, height: 480, layout: 'vertical', fill: p.surf, stroke: { thickness: { left: p.bw }, fill: p.bd }, effect: SHADOW }, [
      frame('drawer-hd', { layout: 'horizontal', width: 'fill_container', alignItems: 'center', justifyContent: 'space_between', padding: 20, stroke: { thickness: { bottom: p.bw }, fill: p.bd } }, [
        text('drawer-title', 'Filters', { fill: p.fg, fontFamily: p.ff, fontSize: p.fl, fontWeight: '700' }),
        text('drawer-x', '✕', { fill: p.mut, fontFamily: p.ff, fontSize: p.fm }),
      ]),
      frame('drawer-body', { layout: 'vertical', width: 'fill_container', gap: 12, padding: 20 }, [fld('drawer-f1', p, 'Category', true), fld('drawer-f2', p, 'Status', true)]),
    ]),
    'organism',
  );
}

export function buildPopover(ctx: BuildContext): Child {
  const p = P(ctx);
  return comp(
    frame('popover', { name: 'Popover', width: 260, layout: 'vertical', gap: 8, padding: 16, fill: p.surf, cornerRadius: p.rmd, stroke: { thickness: p.bw, fill: p.bd }, effect: SHADOW }, [
      text('popover-title', 'Quick tip', { fill: p.fg, fontFamily: p.ff, fontSize: p.fm, fontWeight: '700' }),
      text('popover-body', 'Popovers float above content and point at their trigger.', { fill: p.mut, fontFamily: p.ff, fontSize: p.fs, textGrowth: 'fixed-width', width: 'fill_container' }),
    ]),
    'organism',
  );
}

export function buildToast(ctx: BuildContext): Child {
  const p = P(ctx);
  return comp(
    frame('toast', { name: 'Toast', width: 380, layout: 'horizontal', alignItems: 'start', gap: 12, padding: 16, fill: p.surf, cornerRadius: p.rmd, stroke: { thickness: p.bw, fill: p.bd }, effect: SHADOW }, [
      frame('toast-dot', { width: 10, height: 10, cornerRadius: FULL, fill: p.acc }),
      frame('toast-content', { layout: 'vertical', width: 'fill_container', gap: 4 }, [
        text('toast-title', 'Changes saved', { fill: p.fg, fontFamily: p.ff, fontSize: p.fm, fontWeight: '600' }),
        text('toast-body', 'Your preferences were updated.', { fill: p.mut, fontFamily: p.ff, fontSize: p.fs }),
      ]),
      text('toast-x', '✕', { fill: p.mut, fontFamily: p.ff, fontSize: p.fm }),
    ]),
    'organism',
  );
}
