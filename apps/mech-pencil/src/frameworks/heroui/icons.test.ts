import { describe, expect, it } from 'vitest';
import { emitDocument } from '../../emit/document.ts';
import type { MockupContext } from '../_core/adapter.ts';
import { deriveHeroUITokens } from './derive.ts';
import { HEROUI_ICONS, iconsFoundation } from './icons.ts';
import { heroUIAdapter } from './index.ts';

const ctx: MockupContext = { component: (id) => id, token: (k) => `$${k}` };

describe('icons foundation', () => {
  it('registers the icon size scale as scalar tokens', () => {
    const keys = deriveHeroUITokens().tokens.scalars.map((s) => s.key);
    for (const k of HEROUI_ICONS.sizeKeys) expect(keys).toContain(k);
  });

  it('builds an icons decision page from FA path glyphs', () => {
    const nodes = iconsFoundation().build(ctx);
    expect(nodes).toHaveLength(1);
    const json = JSON.stringify(nodes);
    // glyphs are FA path nodes (render headless); sizes are literal px (a
    // $token on a path width renders 0), tints stay themed via $color.*
    expect(json).toContain('"type":"path"');
    expect(json).toContain('"geometry"');
    expect(json).toContain('$color.foreground');
    expect(json).toContain('robot'); // an FA domain glyph name
  });

  it('emits the icons page into the document and stays valid', () => {
    const out = emitDocument(heroUIAdapter);
    expect(out.foundationSlugs).toContain('icons');
    expect(out.validation.ok).toBe(true);
  });
});
