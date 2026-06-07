import { describe, expect, it } from 'vitest';
import { deriveHeroUITokens } from '../frameworks/heroui/derive.ts';
import { emitSystem } from './system.ts';

const sys = emitSystem(deriveHeroUITokens().tokens);
const FOUNDS = ['colors', 'type', 'icons', 'grids'];

describe('emitSystem (option A, B3)', () => {
  it('emits foundations + component libs + base, all valid', () => {
    expect(sys.foundations).toHaveLength(4);
    expect(sys.components.length).toBeGreaterThan(0);
    expect(sys.base.validation.ok).toBe(true);
    for (const f of sys.foundations) {
      expect(f.libValidation.ok, `${f.slug}.lib`).toBe(true);
      expect(f.previewValidation.ok, `${f.slug}.preview`).toBe(true);
    }
    for (const c of sys.components) {
      expect(c.validation.ok, c.path).toBe(true);
      expect(c.preview.validation.ok, c.preview.path).toBe(true);
    }
  });

  it('component libs import (only) the foundation libs they reference, by relative path', () => {
    for (const c of sys.components) {
      expect(c.imports.every((a) => FOUNDS.includes(a))).toBe(true);
      const imp = c.doc.toObject().imports ?? {};
      for (const a of c.imports) expect(imp[a]).toMatch(/^\.\.\/foundations\/.*\.lib\.pen$/);
    }
  });

  it('base imports all four foundation libs and demos at least one screen', () => {
    const imp = sys.base.doc.toObject().imports ?? {};
    for (const a of FOUNDS) expect(imp[a]).toMatch(/^\.\/foundations\/.*\.lib\.pen$/);
    expect(sys.base.screens.length).toBeGreaterThan(0);
  });

  it('includes page templates and the base demos the desktop ones', () => {
    expect(sys.templates).toHaveLength(12); // 4 templates × 3 viewports
    expect(sys.base.demos).toHaveLength(4); // one per desktop template, inlined
    const imp = sys.base.doc.toObject().imports ?? {};
    // demos are INLINED local copies (cross-file page refs render black), so the
    // base does NOT import template libs — only the foundation libs.
    expect(Object.keys(imp).some((k) => /^tpl\d+$/.test(k))).toBe(false);
  });
});