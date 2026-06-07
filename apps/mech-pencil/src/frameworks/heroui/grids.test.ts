import { describe, expect, it } from 'vitest';
import { emitDocument } from '../../emit/document.ts';
import type { MockupContext } from '../_core/adapter.ts';
import { deriveHeroUITokens } from './derive.ts';
import { HEROUI_GRID, gridsFoundation } from './grids.ts';
import { heroUIAdapter } from './index.ts';

const ctx: MockupContext = { component: (id) => id, token: (k) => `$${k}` };

describe('grids & spacing foundation', () => {
  it('registers the spacing scale + grid tokens as scalars', () => {
    const keys = deriveHeroUITokens().tokens.scalars.map((s) => s.key);
    for (const k of HEROUI_GRID.spaceKeys) expect(keys).toContain(k);
    for (const k of [HEROUI_GRID.columnsKey, HEROUI_GRID.gutterKey, HEROUI_GRID.marginKey, HEROUI_GRID.maxWidthKey]) {
      expect(keys).toContain(k);
    }
  });

  it('binds the page to $space.* + the gutter token, and draws N columns', () => {
    const nodes = gridsFoundation().build(ctx);
    const json = JSON.stringify(nodes);
    for (const k of HEROUI_GRID.spaceKeys) expect(json).toContain(`$${k}`);
    expect(json).toContain(`$${HEROUI_GRID.gutterKey}`);
    // one rect per grid column (id prefix `fg-col-`)
    const cols = (json.match(/fg-col-/g) ?? []).length;
    expect(cols).toBe(HEROUI_GRID.columns);
  });

  it('emits all three foundations into a valid document', () => {
    const out = emitDocument(heroUIAdapter);
    expect(out.foundationSlugs).toEqual(expect.arrayContaining(['icons', 'typography', 'grids']));
    expect(out.validation.ok).toBe(true);
  });
});
