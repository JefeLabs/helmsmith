import { describe, expect, it } from 'vitest';
import { heroUIComponents } from './catalog.ts';
import { buildButton } from './components/button.ts';
import { aliasesReferenced, multiAliasBuildContext } from './foundations.ts';

const ctx = multiAliasBuildContext();

describe('components → multi-alias (option A, B1)', () => {
  it('Button references all four foundation libs by alias', () => {
    const json = JSON.stringify(buildButton(ctx));
    expect(json).toContain('$colors:color.accent');
    expect(json).toContain('$type:font.body-md.size');
    expect(json).toContain('$icons:icon.sm');
    expect(json).toMatch(/\$grids:(space|radius)\./);
    expect(aliasesReferenced(json).sort()).toEqual(['colors', 'grids', 'icons', 'type']);
  });

  it('the whole catalog builds with only known foundation aliases (no legacy $tokens:)', () => {
    const json = JSON.stringify(heroUIComponents().map((s) => s.build(ctx)));
    expect(json).not.toContain('$tokens:');
    const aliases = new Set([...json.matchAll(/\$([a-z][a-z0-9]*):/g)].map((m) => m[1]));
    for (const a of aliases) {
      expect(['colors', 'type', 'icons', 'grids']).toContain(a);
    }
  });
});
