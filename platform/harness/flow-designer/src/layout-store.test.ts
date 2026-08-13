import { describe, expect, it } from 'vitest';
import type { DesignerNode } from './graph-model.ts';
import {
  appliedLayout,
  capturedLayout,
  LAYOUT_KEY,
  readLayouts,
  writeLayout,
} from './layout-store.ts';

function node(id: string, x: number, y: number): DesignerNode {
  return {
    id,
    type: 'step',
    position: { x, y },
    data: { step: { id, kind: 'tool', config: { toolId: 'core:tools:jq' } } },
  };
}

/** Minimal Storage double — the real localStorage is injected in App. */
function fakeStorage(seed?: Record<string, string>) {
  const store = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
}

describe('layout store', () => {
  it('captures node positions keyed by step id', () => {
    const layout = capturedLayout([node('a', 10, 20), node('b', 300, 40)]);
    expect(layout).toEqual({ a: { x: 10, y: 20 }, b: { x: 300, y: 40 } });
  });

  it('overlays stored positions and leaves unknown steps at their computed positions', () => {
    const nodes = [node('a', 0, 0), node('b', 260, 0)];
    const out = appliedLayout(nodes, { a: { x: 500, y: 77 } });
    expect(out.find((n) => n.id === 'a')?.position).toEqual({ x: 500, y: 77 });
    expect(out.find((n) => n.id === 'b')?.position).toEqual({ x: 260, y: 0 });
  });

  it('applies nothing when there is no stored layout', () => {
    const nodes = [node('a', 5, 5)];
    expect(appliedLayout(nodes, undefined)).toEqual(nodes);
  });

  it('reads {} on a missing key and on corrupt JSON', () => {
    expect(readLayouts(fakeStorage())).toEqual({});
    expect(readLayouts(fakeStorage({ [LAYOUT_KEY]: '{nope' }))).toEqual({});
  });

  it('write round-trips through read and preserves other flows', () => {
    const storage = fakeStorage();
    writeLayout(storage, 'flow-1', { a: { x: 1, y: 2 } });
    writeLayout(storage, 'flow-2', { b: { x: 3, y: 4 } });
    writeLayout(storage, 'flow-1', { a: { x: 9, y: 9 } }); // overwrite wholesale
    expect(readLayouts(storage)).toEqual({
      'flow-1': { a: { x: 9, y: 9 } },
      'flow-2': { b: { x: 3, y: 4 } },
    });
  });

  it('write survives a storage that throws (private mode)', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(() => writeLayout(storage, 'flow-1', { a: { x: 1, y: 2 } })).not.toThrow();
  });
});
