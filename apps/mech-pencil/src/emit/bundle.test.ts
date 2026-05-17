import { describe, expect, it } from 'vitest';
import { resolveTheme } from '../theme/config.ts';
import { emitBundle } from './bundle.ts';

describe('emitBundle', () => {
  const b = emitBundle(resolveTheme({ accent: '#3f5694' }));

  it('every non-brand file is theme-INVARIANT (the reuse guarantee)', () => {
    const a = emitBundle(resolveTheme({ accent: '#3f5694' }));
    const z = emitBundle(
      resolveTheme({ accent: '#aa0000', base: 0.02, radius: 'large', fontFamily: 'instrument-sans' }),
    );
    const nonBrand = (e: typeof a) => [
      e.designSystem,
      e.designSystem.preview,
      ...e.groups,
      ...e.groups.map((g) => g.preview),
      ...e.mocks,
    ];
    const dump = (e: typeof a) =>
      nonBrand(e).map((f) => `${f.path}\n${f.doc.toJSON()}`).join('\n');
    expect(dump(a)).toBe(dump(z)); // identical regardless of theme
    expect(a.brand.doc.toJSON()).not.toBe(z.brand.doc.toJSON()); // only brand changes
  });

  it('LAYER 1 design-tokens.lib.pen is variables-only and valid', () => {
    const o = b.brand.doc.toObject();
    expect(b.brand.path).toBe('design-tokens.lib.pen');
    expect(o.children).toEqual([]);
    expect(Object.keys(o.variables ?? {}).length).toBeGreaterThan(40);
    expect(b.brand.validation.ok).toBe(true);
  });

  it('LAYER 2: one valid .lib.pen per HeroUI category, importing brand', () => {
    expect(b.groups.length).toBe(15);
    const buttons = b.groups.find((g) => g.category === 'Buttons');
    expect(buttons?.path).toBe('groups/buttons.lib.pen');
    expect(buttons?.doc.toObject().imports).toEqual({ tokens: '../design-tokens.lib.pen' });
    expect(b.groups.every((g) => g.validation.ok)).toBe(true);
    expect(b.groups.reduce((n, g) => n + g.count, 0)).toBe(71);

    // each lib has a viewable .preview.pen twin (same content, regular .pen)
    expect(buttons?.preview.path).toBe('groups/buttons.preview.pen');
    expect(buttons?.preview.doc.toObject().imports).toEqual({ tokens: '../design-tokens.lib.pen' });
    expect(b.groups.every((g) => g.preview.validation.ok)).toBe(true);
    const lib = JSON.stringify(buttons?.doc.toObject().children);
    const pv = JSON.stringify(buttons?.preview.doc.toObject().children);
    expect(pv).toBe(lib); // identical content, only the file role differs
  });

  it('LAYER 3 design-system.lib.pen aggregates all 71 + has a .preview.pen twin', () => {
    expect(b.designSystem.path).toBe('design-system.lib.pen');
    expect(b.designSystem.doc.toObject().imports).toEqual({ tokens: './design-tokens.lib.pen' });
    expect(b.designSystem.validation.ok).toBe(true);

    const pv = b.designSystem.preview;
    expect(pv.path).toBe('design-system.preview.pen');
    expect(pv.doc.toObject().imports).toEqual({ tokens: './design-tokens.lib.pen' });
    expect(pv.validation.ok).toBe(true);
    // twin = identical content, only the file role differs
    expect(JSON.stringify(pv.doc.toObject().children)).toBe(
      JSON.stringify(b.designSystem.doc.toObject().children),
    );
    const json = JSON.stringify(pv.doc.toObject());
    for (const id of ['button', 'card', 'list-box', 'date-range-picker', 'toast']) {
      expect(json).toContain(`"id":"${id}"`);
    }
  });

  it('LAYER 4 mock: local components, brand-linked, with provenance', () => {
    const hp = b.mocks.find((m) => m.path === 'mocks/homepage.pen');
    expect(hp).toBeTruthy();
    expect(hp?.components.sort()).toEqual(['button', 'card']);
    expect(hp?.doc.toObject().imports).toEqual({ tokens: '../design-tokens.lib.pen' });
    expect(hp?.validation.ok).toBe(true);
    const json = JSON.stringify(hp?.doc.toObject().children);
    expect(json).toContain('"id":"button"');
    expect(json).toContain('"id":"card"');
    // provenance lineage stamped on the local components
    expect(json).toContain(
      '"source":["design-tokens.lib.pen","groups/buttons.lib.pen","design-system.lib.pen","mocks/homepage.pen"]',
    );
    // components reference brand tokens cross-file ($tokens:)
    expect(json).toContain('$tokens:color.accent');
  });
});
