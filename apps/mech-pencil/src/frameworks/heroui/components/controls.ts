/**
 * High-fidelity HeroUI v3 form & action controls (batch 1).
 *
 * Same rules as primitives.ts: token-driven, slugged ids, flex layout,
 * text always has `fill`. Each returns one reusable node via `comp`.
 */

import type { BuildContext } from '../../../design-system/atomic.ts';
import { frame, text } from '../../../pen/builder.ts';
import type { Child } from '../../../pen/schema.ts';
import { FULL, comp } from './primitives.ts';

const C = (ctx: BuildContext) => ({
  fg: ctx.color('foreground'),
  sf: ctx.color('surface-foreground'),
  mut: ctx.color('muted'),
  acc: ctx.color('accent'),
  accFg: ctx.color('accent-foreground'),
  soft: ctx.color('accent-soft'),
  surf: ctx.color('surface'),
  bd: ctx.color('border'),
  fbg: ctx.color('field-background'),
  fph: ctx.color('field-placeholder'),
  ff: ctx.token('font.family'),
  fs: ctx.token('font.size-sm'),
  fm: ctx.token('font.size-md'),
  rsm: ctx.token('radius.sm'),
  rmd: ctx.token('radius.md'),
  bw: ctx.token('border.width'),
});

const label = (id: string, s: string, fill: string, fz: string | number, t: BuildContext, w = '600') =>
  text(id, s, { fill, fontFamily: C(t).ff, fontSize: fz, fontWeight: w });

export function buildCloseButton(ctx: BuildContext): Child {
  const c = C(ctx);
  return comp(
    frame(
      'close-button',
      { name: 'CloseButton', width: 32, height: 32, layout: 'horizontal', alignItems: 'center', justifyContent: 'center', cornerRadius: FULL, fill: c.soft },
      [text('close-button-icon', '✕', { fill: c.mut, fontFamily: c.ff, fontSize: 14, fontWeight: '600' })],
    ),
    'atom',
  );
}

export function buildToggleButton(ctx: BuildContext): Child {
  const c = C(ctx);
  return comp(
    frame(
      'toggle-button',
      { name: 'ToggleButton', layout: 'horizontal', width: 'fit_content', height: 'fit_content', alignItems: 'center', justifyContent: 'center', padding: [16, 10], cornerRadius: c.rmd, fill: c.soft, stroke: { thickness: c.bw, fill: c.acc } },
      [label('toggle-button-label', 'Toggle', c.acc, c.fm, ctx)],
    ),
    'atom',
  );
}

export function buildLink(ctx: BuildContext): Child {
  const c = C(ctx);
  return comp(
    frame('link', { name: 'Link', layout: 'horizontal', width: 'fit_content', height: 'fit_content' }, [
      text('link-label', 'Learn more', { fill: c.acc, fontFamily: c.ff, fontSize: c.fm, fontWeight: '500', underline: true }),
    ]),
    'atom',
  );
}

export function buildKbd(ctx: BuildContext): Child {
  const c = C(ctx);
  return comp(
    frame(
      'kbd',
      { name: 'Kbd', layout: 'horizontal', width: 'fit_content', height: 'fit_content', alignItems: 'center', justifyContent: 'center', padding: [8, 4], cornerRadius: c.rsm, fill: c.surf, stroke: { thickness: c.bw, fill: c.bd } },
      [label('kbd-label', '⌘ K', c.fg, 12, ctx)],
    ),
    'atom',
  );
}

export function buildLabelComp(ctx: BuildContext): Child {
  const c = C(ctx);
  return comp(
    frame('label', { name: 'Label', layout: 'horizontal', width: 'fit_content', height: 'fit_content' }, [
      label('label-text', 'Email address', c.fg, c.fs, ctx),
    ]),
    'atom',
  );
}

export function buildDescription(ctx: BuildContext): Child {
  const c = C(ctx);
  return comp(
    frame('description', { name: 'Description', layout: 'horizontal', width: 'fit_content', height: 'fit_content' }, [
      text('description-text', 'We never share your email.', { fill: c.mut, fontFamily: c.ff, fontSize: c.fs }),
    ]),
    'atom',
  );
}

// Radio has no standalone v3 component (it's a RadioGroup subpart);
// the radio visual lives in `radioRow` used by buildRadioGroup.

export function buildSlider(ctx: BuildContext): Child {
  const c = C(ctx);
  return comp(
    frame('slider', { name: 'Slider', width: 240, height: 20, layout: 'none' }, [
      frame('slider-track', { name: 'Track', x: 0, y: 7, width: 240, height: 6, cornerRadius: FULL, fill: c.bd }),
      frame('slider-fill', { name: 'Fill', x: 0, y: 7, width: 108, height: 6, cornerRadius: FULL, fill: c.acc }),
      frame('slider-thumb', { name: 'Thumb', x: 100, y: 1, width: 18, height: 18, cornerRadius: FULL, fill: c.surf, stroke: { thickness: 2, fill: c.acc } }),
    ]),
    'atom',
  );
}

export function buildTextArea(ctx: BuildContext): Child {
  const c = C(ctx);
  return comp(
    frame(
      'text-area',
      { name: 'TextArea', width: 300, height: 110, layout: 'vertical', padding: 12, cornerRadius: c.rmd, fill: c.fbg, stroke: { thickness: c.bw, fill: c.bd } },
      [text('text-area-text', 'Write something…', { fill: c.fph, fontFamily: c.ff, fontSize: c.fm })],
    ),
    'atom',
  );
}

function fieldBox(id: string, ctx: BuildContext, placeholder: string): Child {
  const c = C(ctx);
  return frame(
    id,
    { name: 'Field', width: 'fill_container', height: 40, layout: 'horizontal', alignItems: 'center', padding: [12, 0], cornerRadius: c.rmd, fill: c.fbg, stroke: { thickness: c.bw, fill: c.bd } },
    [text(`${id}-text`, placeholder, { fill: c.fph, fontFamily: c.ff, fontSize: c.fm })],
  );
}

export function buildTextField(ctx: BuildContext): Child {
  const c = C(ctx);
  return comp(
    frame('text-field', { name: 'TextField', width: 300, layout: 'vertical', gap: 6 }, [
      label('text-field-label', 'Email', c.fg, c.fs, ctx),
      fieldBox('text-field-input', ctx, 'you@example.com'),
      text('text-field-help', 'We never share your email.', { fill: c.mut, fontFamily: c.ff, fontSize: 12 }),
    ]),
    'molecule',
  );
}

export function buildSearchField(ctx: BuildContext): Child {
  const c = C(ctx);
  return comp(
    frame(
      'search-field',
      { name: 'SearchField', width: 300, height: 40, layout: 'horizontal', alignItems: 'center', gap: 8, padding: [12, 0], cornerRadius: c.rmd, fill: c.fbg, stroke: { thickness: c.bw, fill: c.bd } },
      [
        text('search-field-icon', '⌕', { fill: c.mut, fontFamily: c.ff, fontSize: c.fm, fontWeight: '700' }),
        text('search-field-text', 'Search', { fill: c.fph, fontFamily: c.ff, fontSize: c.fm }),
      ],
    ),
    'molecule',
  );
}

export function buildNumberField(ctx: BuildContext): Child {
  const c = C(ctx);
  return comp(
    frame(
      'number-field',
      { name: 'NumberField', width: 180, height: 40, layout: 'horizontal', alignItems: 'center', padding: [12, 0], cornerRadius: c.rmd, fill: c.fbg, stroke: { thickness: c.bw, fill: c.bd } },
      [
        text('number-field-value', '12', { fill: c.fg, fontFamily: c.ff, fontSize: c.fm, width: 'fill_container', textGrowth: 'fixed-width' }),
        frame('number-field-step', { name: 'Steppers', layout: 'vertical', width: 'fit_content' }, [
          text('number-field-up', '▴', { fill: c.mut, fontFamily: c.ff, fontSize: 10 }),
          text('number-field-down', '▾', { fill: c.mut, fontFamily: c.ff, fontSize: 10 }),
        ]),
      ],
    ),
    'molecule',
  );
}

export function buildInputGroup(ctx: BuildContext): Child {
  const c = C(ctx);
  return comp(
    frame('input-group', { name: 'InputGroup', width: 320, height: 40, layout: 'horizontal', alignItems: 'center' }, [
      frame('input-group-addon', { name: 'Addon', height: 40, layout: 'horizontal', alignItems: 'center', padding: [12, 0], fill: c.soft, cornerRadius: [c.rmd, 0, 0, c.rmd] }, [
        text('input-group-addon-text', 'https://', { fill: c.mut, fontFamily: c.ff, fontSize: c.fm }),
      ]),
      frame('input-group-input', { name: 'Input', width: 'fill_container', height: 40, layout: 'horizontal', alignItems: 'center', padding: [12, 0], fill: c.fbg, stroke: { thickness: c.bw, fill: c.bd }, cornerRadius: [0, c.rmd, c.rmd, 0] }, [
        text('input-group-input-text', 'your-site', { fill: c.fph, fontFamily: c.ff, fontSize: c.fm }),
      ]),
    ]),
    'molecule',
  );
}

export function buildInputOtp(ctx: BuildContext): Child {
  const c = C(ctx);
  const cell = (i: number, val: string, active: boolean) =>
    frame(`input-otp-${i}`, { name: `Cell ${i}`, width: 44, height: 48, layout: 'horizontal', alignItems: 'center', justifyContent: 'center', cornerRadius: c.rmd, fill: c.fbg, stroke: { thickness: active ? 2 : c.bw, fill: active ? c.acc : c.bd } }, [
      text(`input-otp-${i}-d`, val, { fill: c.fg, fontFamily: c.ff, fontSize: 20, fontWeight: '600' }),
    ]);
  return comp(
    frame('input-otp', { name: 'InputOTP', layout: 'horizontal', width: 'fit_content', gap: 8 }, [
      cell(0, '4', false), cell(1, '2', false), cell(2, '', true), cell(3, '', false),
    ]),
    'molecule',
  );
}

export function buildFieldset(ctx: BuildContext): Child {
  const c = C(ctx);
  return comp(
    frame('fieldset', { name: 'Fieldset', width: 320, layout: 'vertical', gap: 12, padding: 16, cornerRadius: c.rmd, stroke: { thickness: c.bw, fill: c.bd } }, [
      label('fieldset-legend', 'Notifications', c.fg, c.fm, ctx),
      fieldBox('fieldset-field-1', ctx, 'Email'),
      fieldBox('fieldset-field-2', ctx, 'SMS'),
    ]),
    'molecule',
  );
}

function checkRow(prefix: string, i: number, text2: string, ctx: BuildContext, checked: boolean): Child {
  const c = C(ctx);
  return frame(`${prefix}-${i}`, { name: text2, layout: 'horizontal', width: 'fit_content', alignItems: 'center', gap: 10 }, [
    frame(`${prefix}-${i}-box`, { name: 'Box', width: 18, height: 18, layout: 'horizontal', alignItems: 'center', justifyContent: 'center', cornerRadius: c.rsm, fill: checked ? c.acc : c.surf, stroke: checked ? undefined : { thickness: c.bw, fill: c.bd } }, checked ? [text(`${prefix}-${i}-chk`, '✓', { fill: c.accFg, fontFamily: c.ff, fontSize: 12, fontWeight: '700' })] : []),
    text(`${prefix}-${i}-label`, text2, { fill: c.fg, fontFamily: c.ff, fontSize: c.fm }),
  ]);
}

export function buildCheckboxGroup(ctx: BuildContext): Child {
  return comp(
    frame('checkbox-group', { name: 'CheckboxGroup', layout: 'vertical', width: 'fit_content', gap: 12 }, [
      checkRow('checkbox-group', 0, 'Newsletter', ctx, true),
      checkRow('checkbox-group', 1, 'Product updates', ctx, false),
    ]),
    'molecule',
  );
}

function radioRow(prefix: string, i: number, text2: string, ctx: BuildContext, sel: boolean): Child {
  const c = C(ctx);
  return frame(`${prefix}-${i}`, { name: text2, layout: 'horizontal', width: 'fit_content', alignItems: 'center', gap: 10 }, [
    frame(`${prefix}-${i}-o`, { name: 'O', width: 18, height: 18, layout: 'horizontal', alignItems: 'center', justifyContent: 'center', cornerRadius: FULL, fill: c.surf, stroke: { thickness: 2, fill: sel ? c.acc : c.bd } }, sel ? [frame(`${prefix}-${i}-dot`, { name: 'Dot', width: 8, height: 8, cornerRadius: FULL, fill: c.acc })] : []),
    text(`${prefix}-${i}-label`, text2, { fill: c.fg, fontFamily: c.ff, fontSize: c.fm }),
  ]);
}

export function buildRadioGroup(ctx: BuildContext): Child {
  return comp(
    frame('radio-group', { name: 'RadioGroup', layout: 'vertical', width: 'fit_content', gap: 12 }, [
      radioRow('radio-group', 0, 'Monthly', ctx, true),
      radioRow('radio-group', 1, 'Yearly', ctx, false),
    ]),
    'molecule',
  );
}

export function buildTagGroup(ctx: BuildContext): Child {
  const c = C(ctx);
  const tag = (i: number, s: string) =>
    frame(`tag-group-${i}`, { name: s, layout: 'horizontal', width: 'fit_content', alignItems: 'center', gap: 6, padding: [10, 5], cornerRadius: FULL, fill: c.soft }, [
      text(`tag-group-${i}-label`, s, { fill: c.acc, fontFamily: c.ff, fontSize: c.fs, fontWeight: '500' }),
      text(`tag-group-${i}-x`, '✕', { fill: c.acc, fontFamily: c.ff, fontSize: 11 }),
    ]);
  return comp(
    frame('tag-group', { name: 'TagGroup', layout: 'horizontal', width: 'fit_content', gap: 8 }, [tag(0, 'Design'), tag(1, 'Eng'), tag(2, 'Ops')]),
    'molecule',
  );
}

export function buildButtonGroup(ctx: BuildContext): Child {
  const c = C(ctx);
  const seg = (i: number, s: string, active: boolean) =>
    frame(`button-group-${i}`, { name: s, layout: 'horizontal', alignItems: 'center', justifyContent: 'center', padding: [16, 10], fill: active ? c.acc : c.surf, stroke: { thickness: c.bw, fill: c.bd } }, [
      text(`button-group-${i}-label`, s, { fill: active ? c.accFg : c.fg, fontFamily: c.ff, fontSize: c.fm, fontWeight: '600' }),
    ]);
  return comp(
    frame('button-group', { name: 'ButtonGroup', layout: 'horizontal', width: 'fit_content', cornerRadius: c.rmd, clip: true }, [
      seg(0, 'Day', true), seg(1, 'Week', false), seg(2, 'Month', false),
    ]),
    'molecule',
  );
}

export function buildToggleButtonGroup(ctx: BuildContext): Child {
  const c = C(ctx);
  const seg = (i: number, s: string, active: boolean) =>
    frame(`toggle-button-group-${i}`, { name: s, layout: 'horizontal', alignItems: 'center', justifyContent: 'center', padding: [14, 9], cornerRadius: c.rsm, fill: active ? c.soft : 'transparent' }, [
      text(`toggle-button-group-${i}-label`, s, { fill: active ? c.acc : c.mut, fontFamily: c.ff, fontSize: c.fs, fontWeight: '600' }),
    ]);
  return comp(
    frame('toggle-button-group', { name: 'ToggleButtonGroup', layout: 'horizontal', width: 'fit_content', gap: 4, padding: 4, cornerRadius: c.rmd, fill: c.surf, stroke: { thickness: c.bw, fill: c.bd } }, [
      seg(0, 'B', true), seg(1, 'I', false), seg(2, 'U', false),
    ]),
    'molecule',
  );
}
