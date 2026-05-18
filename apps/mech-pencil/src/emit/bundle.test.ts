import { describe, expect, it } from 'vitest';
import { resolveTheme } from '../theme/config.ts';
import { emitBundle } from './bundle.ts';

describe('emitBundle', () => {
  const b = emitBundle(resolveTheme({ accent: '#3f5694' }));

  it('every non-token file is theme-INVARIANT (the reuse guarantee)', () => {
    const a = emitBundle(resolveTheme({ accent: '#3f5694' }));
    const z = emitBundle(
      resolveTheme({ accent: '#aa0000', base: 0.02, radius: 'large', fontFamily: 'instrument-sans' }),
    );
    const nonBrand = (e: typeof a) => [
      ...e.designSystem,
      ...e.designSystem.map((d) => d.preview),
      ...e.groups,
      ...e.groups.map((g) => g.preview),
      ...e.mocks,
    ];
    const dump = (e: typeof a) =>
      nonBrand(e).map((f) => `${f.path}\n${f.doc.toJSON()}`).join('\n');
    expect(dump(a)).toBe(dump(z)); // identical regardless of theme
    expect(a.brand.doc.toJSON()).not.toBe(z.brand.doc.toJSON()); // only tokens change
  });

  it('LAYER 1 design-tokens.lib.pen is variables-only and valid', () => {
    const o = b.brand.doc.toObject();
    expect(b.brand.path).toBe('design-tokens.lib.pen');
    expect(o.children).toEqual([]);
    expect(Object.keys(o.variables ?? {}).length).toBeGreaterThan(40);
    expect(b.brand.validation.ok).toBe(true);
  });

  it('LAYER 2: core/<category>.lib.pen + .preview.pen, importing tokens', () => {
    expect(b.groups.length).toBe(15);
    const buttons = b.groups.find((g) => g.category === 'Buttons');
    expect(buttons?.path).toBe('core/buttons.lib.pen');
    expect(buttons?.doc.toObject().imports).toEqual({ tokens: '../design-tokens.lib.pen' });
    expect(buttons?.preview.path).toBe('core/buttons.preview.pen');
    expect(b.groups.every((g) => g.validation.ok && g.preview.validation.ok)).toBe(true);
    expect(b.groups.reduce((n, g) => n + g.count, 0)).toBe(71);
    expect(JSON.stringify(buttons?.preview.doc.toObject().children)).toBe(
      JSON.stringify(buttons?.doc.toObject().children),
    );
  });

  it('LAYER 3: design-system/ one file per atomic level + previews', () => {
    const levels = b.designSystem.map((d) => d.level).sort();
    expect(levels).toEqual(['atoms', 'molecules', 'organisms', 'templates']);
    const atoms = b.designSystem.find((d) => d.level === 'atoms');
    expect(atoms?.path).toBe('design-system/atoms.lib.pen');
    expect(atoms?.preview.path).toBe('design-system/atoms.preview.pen');
    expect(atoms?.doc.toObject().imports).toEqual({ tokens: '../design-tokens.lib.pen' });
    expect((atoms?.count ?? 0)).toBeGreaterThan(0);
    // templates has no components yet but is still a valid placeholder
    const templates = b.designSystem.find((d) => d.level === 'templates');
    expect(templates?.count).toBe(0);
    expect(b.designSystem.every((d) => d.validation.ok && d.preview.validation.ok)).toBe(true);
    // every component lands in exactly one level file
    expect(b.designSystem.reduce((n, d) => n + d.count, 0)).toBe(71);
  });

  it('LAYER 4 mock: local components, token-linked, provenance up the chain', () => {
    const hp = b.mocks.find((m) => m.path === 'mocks/homepage.pen');
    expect(hp).toBeTruthy();
    expect(hp?.components.sort()).toEqual(['button', 'card']);
    expect(hp?.doc.toObject().imports).toEqual({ tokens: '../design-tokens.lib.pen' });
    expect(hp?.validation.ok).toBe(true);
    const json = JSON.stringify(hp?.doc.toObject().children);
    expect(json).toContain('"id":"button"');
    expect(json).toContain('"id":"card"');
    // button = atom / Buttons category → provenance through the new layout
    expect(json).toContain(
      '"source":["design-tokens.lib.pen","core/buttons.lib.pen","design-system/atoms.lib.pen","mocks/homepage.pen"]',
    );
    expect(json).toContain('$tokens:color.accent');
  });
});
