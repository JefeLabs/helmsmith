import { describe, expect, it } from 'vitest';
import { defaultBuildContext } from '../../design-system/atomic.ts';
import { buildButton } from './components/button.ts';

describe('Button consumes the foundations (foundations → components)', () => {
  it('binds glyph → $icon.sm, label → $font.body-md.size, gap/padding → $space.*', () => {
    const json = JSON.stringify(buildButton(defaultBuildContext));
    expect(json).toContain('$icon.sm'); // icons foundation
    expect(json).toContain('$font.body-md.size'); // typography foundation
    expect(json).toContain('$space.'); // spacing foundation
  });
});
