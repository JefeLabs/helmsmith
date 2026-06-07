import { describe, expect, it } from 'vitest';
import { defaultBuildContext } from '../../design-system/atomic.ts';
import { buildButton } from './components/button.ts';

describe('Button consumes the foundations (foundations → components)', () => {
  it('consumes typography + spacing tokens; FA glyph is a path', () => {
    const json = JSON.stringify(buildButton(defaultBuildContext));
    expect(json).toContain('$font.body-md.size'); // typography foundation
    expect(json).toContain('$space.'); // spacing foundation
    // the leading glyph is an FA path (literal size — a $token on a path width
    // renders 0), so the button no longer references the icon size token.
    expect(json).toContain('"type":"path"');
  });
});
