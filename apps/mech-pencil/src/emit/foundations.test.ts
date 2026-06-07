import { describe, expect, it } from 'vitest';
import { deriveHeroUITokens } from '../frameworks/heroui/derive.ts';
import { aliasForKey } from '../frameworks/heroui/foundations.ts';
import { emitFoundations } from './foundations.ts';

const arts = emitFoundations(deriveHeroUITokens().tokens);
const bySlug = Object.fromEntries(arts.map((a) => [a.slug, a]));

describe('multi-alias token routing (option A)', () => {
  it('routes each token-key segment to its foundation alias', () => {
    expect(aliasForKey('color.accent')).toBe('colors');
    expect(aliasForKey('font.body-md.size')).toBe('type');
    expect(aliasForKey('icon.sm')).toBe('icons');
    expect(aliasForKey('space.4')).toBe('grids');
    expect(aliasForKey('grid.gutter')).toBe('grids');
    expect(aliasForKey('radius.md')).toBe('grids');
  });
});

describe('emitFoundations', () => {
  it('emits a valid lib + preview for all four foundations', () => {
    expect(Object.keys(bySlug).sort()).toEqual(['colors', 'grids', 'icons', 'typography']);
    for (const a of arts) {
      expect(a.libValidation.ok, `${a.slug}.lib`).toBe(true);
      expect(a.previewValidation.ok, `${a.slug}.preview`).toBe(true);
    }
  });

  it('each lib holds ONLY its own token slice', () => {
    const ok = (slug: string, pred: (k: string) => boolean) =>
      Object.keys(bySlug[slug].lib.toObject().variables ?? {}).every(pred);
    expect(ok('colors', (k) => k.startsWith('color.'))).toBe(true);
    expect(ok('typography', (k) => k.startsWith('font.'))).toBe(true);
    expect(ok('icons', (k) => k.startsWith('icon.'))).toBe(true);
    expect(ok('grids', (k) => /^(space|grid|radius|border|opacity|ring)\./.test(k))).toBe(true);
  });

  it('preview pages import the foundation libs they reference (cross-alias)', () => {
    // the icons page tints via $colors and labels via $type (its own glyphs are
    // literal-sized FA paths, so it doesn't import the icons lib itself)
    expect(bySlug.icons.imports).toEqual(expect.arrayContaining(['colors', 'type']));
    const imp = bySlug.icons.preview.toObject().imports ?? {};
    // import paths carry no leading `./` — Pencil chokes on that form
    expect(imp.colors).toBe('colors.lib.pen');
    expect(imp.type).toBe('typography.lib.pen');
  });
});