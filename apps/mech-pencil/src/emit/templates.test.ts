import { describe, expect, it } from 'vitest';
import { deriveHeroUITokens } from '../frameworks/heroui/derive.ts';
import { PAGE_TEMPLATES, VIEWPORTS } from '../frameworks/heroui/templates.ts';
import { emitTemplates } from './templates.ts';

const arts = emitTemplates(deriveHeroUITokens().tokens);
const FOUNDS = ['colors', 'type', 'icons', 'grids'];

describe('emitTemplates (option A, B2)', () => {
  it('emits a valid lib + preview for every template × viewport', () => {
    expect(arts).toHaveLength(PAGE_TEMPLATES.length * VIEWPORTS.length); // 4 × 3
    for (const a of arts) {
      expect(a.libValidation.ok, a.libPath).toBe(true);
      expect(a.previewValidation.ok, a.previewPath).toBe(true);
    }
  });

  it('covers primary/secondary/tertiary/modal across desktop/tablet/mobile', () => {
    const slugs = new Set(arts.map((a) => a.slug));
    for (const t of PAGE_TEMPLATES) for (const vp of VIEWPORTS) expect(slugs.has(`${t.id}-${vp.id}`)).toBe(true);
  });

  it('template libs import only foundation libs (relative path)', () => {
    for (const a of arts) {
      expect(a.imports.every((x) => FOUNDS.includes(x))).toBe(true);
      const imp = a.lib.toObject().imports ?? {};
      for (const x of a.imports) expect(imp[x]).toMatch(/^\.\.\/foundations\/.*\.lib\.pen$/);
    }
  });

  it('exposes the page as a reusable node', () => {
    const reusableSomewhere = (n: unknown): boolean => {
      const node = n as { reusable?: boolean; children?: unknown[] };
      return node?.reusable === true || (node?.children ?? []).some(reusableSomewhere);
    };
    expect(arts[0].lib.toObject().children.some(reusableSomewhere)).toBe(true);
  });
});