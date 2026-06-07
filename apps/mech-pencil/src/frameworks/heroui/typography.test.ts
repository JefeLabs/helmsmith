import { describe, expect, it } from 'vitest';
import { emitDocument } from '../../emit/document.ts';
import type { MockupContext } from '../_core/adapter.ts';
import { deriveHeroUITokens } from './derive.ts';
import { heroUIAdapter } from './index.ts';
import { TYPE_STEPS, heroUITypography, typographyFoundation } from './typography.ts';

const ctx: MockupContext = { component: (id) => id, token: (k) => `$${k}` };

describe('typography foundation', () => {
  it('registers every type-scale size as a scalar token', () => {
    const keys = deriveHeroUITokens().tokens.scalars.map((s) => s.key);
    for (const s of TYPE_STEPS) expect(keys).toContain(s.sizeKey);
    for (const fam of ['font.family', 'font.display', 'font.mono']) expect(keys).toContain(fam);
  });

  it('single voice uses one family for display + body', () => {
    const tf = heroUITypography({ mode: 'single', body: 'Inter' });
    expect(tf.displayFamily).toBe('Inter');
    expect(tf.bodyFamily).toBe('Inter');
  });

  it('set voice pairs a distinct display face with the body', () => {
    const tf = heroUITypography({ mode: 'set', display: 'Space Grotesk', body: 'Inter' });
    expect(tf.displayFamily).toBe('Space Grotesk');
    expect(tf.bodyFamily).toBe('Inter');
  });

  it('a curated set id (fontpair.co) resolves its families + set mode', () => {
    const tf = heroUITypography({ set: 'urbanist-opensans' });
    expect(tf.mode).toBe('set');
    expect(tf.displayFamily).toBe('Urbanist');
    expect(tf.bodyFamily).toBe('Open Sans');
  });

  it('binds specimens to family + size tokens by role', () => {
    const json = JSON.stringify(typographyFoundation().build(ctx));
    expect(json).toContain('$font.display'); // headings
    expect(json).toContain('$font.mono'); // code
    expect(json).toContain('$font.h1.size'); // size token
    expect(json).toContain('$font.body-md.size');
  });

  it('emits both foundation pages into a valid document', () => {
    const out = emitDocument(heroUIAdapter);
    expect(out.foundationSlugs).toEqual(expect.arrayContaining(['icons', 'typography']));
    expect(out.validation.ok).toBe(true);
  });
});
