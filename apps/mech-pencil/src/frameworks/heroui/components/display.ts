/**
 * High-fidelity HeroUI v3 display / status / data-entry adornments
 * (batch 2): the remaining 12 atoms + 8 molecules. Token-driven,
 * slugged ids; ellipse used for rings (spinner / progress-circle).
 */

import type { BuildContext } from '../../../design-system/atomic.ts';
import { frame, text } from '../../../pen/builder.ts';
import type { Child, Ellipse } from '../../../pen/schema.ts';
import { FULL, comp } from './primitives.ts';

const P = (ctx: BuildContext) => ({
  fg: ctx.color('foreground'),
  mut: ctx.color('muted'),
  acc: ctx.color('accent'),
  accFg: ctx.color('accent-foreground'),
  soft: ctx.color('accent-soft'),
  surf: ctx.color('surface'),
  bd: ctx.color('border'),
  fbg: ctx.color('field-background'),
  fph: ctx.color('field-placeholder'),
  danger: ctx.color('danger'),
  ff: ctx.token('font.family'),
  fs: ctx.token('font.size-sm'),
  fm: ctx.token('font.size-md'),
  fl: ctx.token('font.size-lg'),
  rsm: ctx.token('radius.sm'),
  rmd: ctx.token('radius.md'),
  rlg: ctx.token('radius.lg'),
  bw: ctx.token('border.width'),
});

const ring = (
  id: string,
  d: number,
  fill: string,
  sweep: number,
  start: number,
  inner = 0.8,
): Ellipse => ({
  id,
  type: 'ellipse',
  width: d,
  height: d,
  fill,
  innerRadius: inner,
  startAngle: start,
  sweepAngle: sweep,
});

export function buildSpinner(ctx: BuildContext): Child {
  const p = P(ctx);
  return comp(
    frame('spinner', { name: 'Spinner', width: 32, height: 32, layout: 'none' }, [
      ring('spinner-track', 32, p.bd, 360, 0),
      ring('spinner-arc', 32, p.acc, 280, 90),
    ]),
    'atom',
  );
}

export function buildSkeleton(ctx: BuildContext): Child {
  const p = P(ctx);
  return comp(
    frame('skeleton', { name: 'Skeleton', width: 240, layout: 'vertical', gap: 10 }, [
      frame('skeleton-a', { width: 240, height: 16, cornerRadius: p.rsm, fill: p.bd }),
      frame('skeleton-b', { width: 180, height: 16, cornerRadius: p.rsm, fill: p.bd }),
      frame('skeleton-c', { width: 210, height: 16, cornerRadius: p.rsm, fill: p.bd }),
    ]),
    'atom',
  );
}

export function buildSeparator(ctx: BuildContext): Child {
  const p = P(ctx);
  return comp(
    frame('separator', { name: 'Separator', width: 240, height: 1, fill: p.bd }),
    'atom',
  );
}

export function buildSurface(ctx: BuildContext): Child {
  const p = P(ctx);
  return comp(
    frame(
      'surface',
      {
        name: 'Surface',
        width: 240,
        height: 120,
        layout: 'horizontal',
        alignItems: 'center',
        justifyContent: 'center',
        fill: p.surf,
        cornerRadius: p.rlg,
        stroke: { thickness: p.bw, fill: p.bd },
        effect: { type: 'shadow', shadowType: 'outer', offset: { x: 0, y: 2 }, blur: 10, spread: 0, color: '#0000001f' },
      },
      [text('surface-label', 'Surface', { fill: p.mut, fontFamily: p.ff, fontSize: p.fs })],
    ),
    'atom',
  );
}

export function buildScrollShadow(ctx: BuildContext): Child {
  const p = P(ctx);
  return comp(
    frame('scroll-shadow', { name: 'ScrollShadow', width: 240, height: 120, fill: p.surf, cornerRadius: p.rmd, stroke: { thickness: p.bw, fill: p.bd }, clip: true, layout: 'none' }, [
      text('scroll-shadow-text', 'scrollable…', { x: 16, y: 16, fill: p.mut, fontFamily: p.ff, fontSize: p.fs }),
      frame('scroll-shadow-fade', {
        x: 0,
        y: 84,
        width: 240,
        height: 36,
        fill: { type: 'gradient', gradientType: 'linear', rotation: 180, colors: [{ color: '#00000000', position: 0 }, { color: '#00000022', position: 1 }] },
      }),
    ]),
    'atom',
  );
}

function bar(id: string, ctx: BuildContext, pct: number): Child {
  const p = P(ctx);
  return frame(id, { name: 'Track', width: 240, height: 8, cornerRadius: FULL, fill: p.bd, layout: 'none' }, [
    frame(`${id}-fill`, { x: 0, y: 0, width: Math.round(240 * pct), height: 8, cornerRadius: FULL, fill: p.acc }),
  ]);
}

export function buildMeter(ctx: BuildContext): Child {
  return comp(frame('meter', { name: 'Meter', width: 240, layout: 'vertical', gap: 6 }, [bar('meter-track', ctx, 0.7)]), 'atom');
}

export function buildProgressBar(ctx: BuildContext): Child {
  const p = P(ctx);
  return comp(
    frame('progress-bar', { name: 'ProgressBar', width: 240, layout: 'vertical', gap: 6 }, [
      frame('progress-bar-row', { layout: 'horizontal', width: 'fill_container', justifyContent: 'space_between' }, [
        text('progress-bar-label', 'Uploading', { fill: p.fg, fontFamily: p.ff, fontSize: p.fs, fontWeight: '600' }),
        text('progress-bar-pct', '60%', { fill: p.mut, fontFamily: p.ff, fontSize: p.fs }),
      ]),
      bar('progress-bar-track', ctx, 0.6),
    ]),
    'atom',
  );
}

export function buildProgressCircle(ctx: BuildContext): Child {
  const p = P(ctx);
  return comp(
    frame('progress-circle', { name: 'ProgressCircle', width: 64, height: 64, layout: 'none' }, [
      ring('progress-circle-track', 64, p.bd, 360, 0, 0.8),
      ring('progress-circle-arc', 64, p.acc, 252, 90, 0.8),
      text('progress-circle-text', '70%', { x: 18, y: 24, fill: p.fg, fontFamily: p.ff, fontSize: p.fs, fontWeight: '600' }),
    ]),
    'atom',
  );
}

export function buildColorSwatch(ctx: BuildContext): Child {
  const p = P(ctx);
  return comp(
    frame('color-swatch', { name: 'ColorSwatch', width: 40, height: 40, cornerRadius: p.rmd, fill: p.acc, stroke: { thickness: p.bw, fill: p.bd } }),
    'atom',
  );
}

export function buildErrorMessage(ctx: BuildContext): Child {
  const p = P(ctx);
  return comp(
    frame('error-message', { name: 'ErrorMessage', layout: 'horizontal', width: 'fit_content' }, [
      text('error-message-text', 'Something went wrong.', { fill: p.danger, fontFamily: p.ff, fontSize: p.fs }),
    ]),
    'atom',
  );
}

export function buildFieldError(ctx: BuildContext): Child {
  const p = P(ctx);
  return comp(
    frame('field-error', { name: 'FieldError', layout: 'horizontal', width: 'fit_content', alignItems: 'center', gap: 6 }, [
      text('field-error-icon', '⚠', { fill: p.danger, fontFamily: p.ff, fontSize: p.fs }),
      text('field-error-text', 'This field is required', { fill: p.danger, fontFamily: p.ff, fontSize: p.fs }),
    ]),
    'atom',
  );
}

export function buildTypography(ctx: BuildContext): Child {
  const p = P(ctx);
  return comp(
    frame('typography', { name: 'Typography', layout: 'vertical', width: 'fit_content', gap: 8 }, [
      text('typography-h', 'Heading', { fill: p.fg, fontFamily: p.ff, fontSize: 28, fontWeight: '800' }),
      text('typography-b', 'Body text that explains the heading above.', { fill: p.fg, fontFamily: p.ff, fontSize: p.fm }),
      text('typography-c', 'CAPTION', { fill: p.mut, fontFamily: p.ff, fontSize: 12, fontWeight: '600' }),
    ]),
    'atom',
  );
}

function field(id: string, ctx: BuildContext, value: string, glyph: string): Child {
  const p = P(ctx);
  return frame(id, { name: 'Field', width: 220, height: 40, layout: 'horizontal', alignItems: 'center', justifyContent: 'space_between', padding: [12, 0], cornerRadius: p.rmd, fill: p.fbg, stroke: { thickness: p.bw, fill: p.bd } }, [
    text(`${id}-val`, value, { fill: p.fph, fontFamily: p.ff, fontSize: p.fm }),
    text(`${id}-icon`, glyph, { fill: p.mut, fontFamily: p.ff, fontSize: p.fm }),
  ]);
}

export function buildColorField(ctx: BuildContext): Child {
  const p = P(ctx);
  return comp(
    frame('color-field', { name: 'ColorField', width: 220, height: 40, layout: 'horizontal', alignItems: 'center', gap: 10, padding: [12, 0], cornerRadius: p.rmd, fill: p.fbg, stroke: { thickness: p.bw, fill: p.bd } }, [
      frame('color-field-sw', { width: 20, height: 20, cornerRadius: p.rsm, fill: p.acc }),
      text('color-field-val', '#3F5694', { fill: p.fg, fontFamily: p.ff, fontSize: p.fm }),
    ]),
    'molecule',
  );
}

export function buildDateField(ctx: BuildContext): Child {
  return comp(field('date-field', ctx, 'MM / DD / YYYY', '▦'), 'molecule');
}
export function buildTimeField(ctx: BuildContext): Child {
  return comp(field('time-field', ctx, 'HH : MM', '◷'), 'molecule');
}

export function buildColorSlider(ctx: BuildContext): Child {
  const p = P(ctx);
  return comp(
    frame('color-slider', { name: 'ColorSlider', width: 240, height: 16, layout: 'none' }, [
      frame('color-slider-bar', { x: 0, y: 2, width: 240, height: 12, cornerRadius: FULL, fill: { type: 'gradient', gradientType: 'linear', rotation: 90, colors: [{ color: '#ff0000', position: 0 }, { color: '#00ff00', position: 0.5 }, { color: '#0000ff', position: 1 }] } }),
      frame('color-slider-thumb', { x: 150, y: 0, width: 16, height: 16, cornerRadius: FULL, fill: p.surf, stroke: { thickness: 2, fill: p.bd } }),
    ]),
    'molecule',
  );
}

export function buildColorArea(ctx: BuildContext): Child {
  const p = P(ctx);
  return comp(
    frame('color-area', { name: 'ColorArea', width: 220, height: 140, cornerRadius: p.rmd, layout: 'none', fill: { type: 'gradient', gradientType: 'linear', rotation: 90, colors: [{ color: '#ffffff', position: 0 }, { color: p.acc, position: 1 }] } }, [
      frame('color-area-thumb', { x: 150, y: 40, width: 16, height: 16, cornerRadius: FULL, fill: '#00000000', stroke: { thickness: 2, fill: '#ffffff' } }),
    ]),
    'molecule',
  );
}

export function buildColorSwatchPicker(ctx: BuildContext): Child {
  const p = P(ctx);
  const sw = (i: number, color: string, sel: boolean) =>
    frame(`color-swatch-picker-${i}`, { width: 28, height: 28, cornerRadius: p.rsm, fill: color, stroke: sel ? { thickness: 2, fill: p.fg } : { thickness: p.bw, fill: p.bd } });
  const palette = ['#c2453f', '#c98a2e', '#2f9e6e', '#3a72b8', '#3f5694'];
  return comp(
    frame('color-swatch-picker', { name: 'ColorSwatchPicker', layout: 'horizontal', width: 'fit_content', gap: 8 }, palette.map((cl, i) => sw(i, cl, i === 4))),
    'molecule',
  );
}

export function buildBreadcrumbs(ctx: BuildContext): Child {
  const p = P(ctx);
  const seg = (i: number, s: string, last: boolean) =>
    text(`breadcrumbs-${i}`, s, { fill: last ? p.fg : p.mut, fontFamily: p.ff, fontSize: p.fs, fontWeight: last ? '600' : '400' });
  const sepN = (i: number) => text(`breadcrumbs-sep-${i}`, '/', { fill: p.mut, fontFamily: p.ff, fontSize: p.fs });
  return comp(
    frame('breadcrumbs', { name: 'Breadcrumbs', layout: 'horizontal', width: 'fit_content', alignItems: 'center', gap: 8 }, [
      seg(0, 'Home', false), sepN(0), seg(1, 'Library', false), sepN(1), seg(2, 'Data', true),
    ]),
    'molecule',
  );
}

export function buildDisclosure(ctx: BuildContext): Child {
  const p = P(ctx);
  return comp(
    frame('disclosure', { name: 'Disclosure', width: 320, layout: 'vertical', cornerRadius: p.rmd, stroke: { thickness: p.bw, fill: p.bd }, clip: true }, [
      frame('disclosure-header', { layout: 'horizontal', width: 'fill_container', alignItems: 'center', justifyContent: 'space_between', padding: 16, fill: p.surf }, [
        text('disclosure-title', 'What is included?', { fill: p.fg, fontFamily: p.ff, fontSize: p.fm, fontWeight: '600' }),
        text('disclosure-chev', '▾', { fill: p.mut, fontFamily: p.ff, fontSize: p.fm }),
      ]),
      frame('disclosure-body', { layout: 'vertical', width: 'fill_container', padding: [16, 0, 16, 16] }, [
        text('disclosure-body-text', 'Everything in the design system, themeable via tokens.', { fill: p.mut, fontFamily: p.ff, fontSize: p.fs, textGrowth: 'fixed-width', width: 'fill_container' }),
      ]),
    ]),
    'molecule',
  );
}
