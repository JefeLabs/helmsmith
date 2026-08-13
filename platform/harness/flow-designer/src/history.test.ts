import { describe, expect, it } from 'vitest';
import type { GraphSnapshot } from './history.ts';
import { emptyHistory, HISTORY_CAP, recorded, redone, undone } from './history.ts';

function snap(n: number): GraphSnapshot {
  return {
    nodes: [
      {
        id: `n${n}`,
        type: 'step',
        position: { x: n, y: n },
        data: {
          step: {
            id: `n${n}`,
            kind: 'transform',
            config: { expression: { kind: 'literal', value: n } },
          },
        },
      },
    ],
    edges: [],
  } as unknown as GraphSnapshot;
}

describe('designer history', () => {
  it('undo restores the recorded snapshot and redo returns forward', () => {
    // Editing from state 1 → 2: record(1) at the mutation point.
    let h = recorded(emptyHistory, snap(1));
    const u = undone(h, snap(2));
    expect(u).not.toBeNull();
    expect(u?.snapshot).toEqual(snap(1));
    h = u?.history ?? h;
    const r = redone(h, snap(1));
    expect(r?.snapshot).toEqual(snap(2));
  });

  it('a new recording clears the redo future', () => {
    let h = recorded(emptyHistory, snap(1));
    const u = undone(h, snap(2));
    h = u?.history ?? h;
    expect(h.future).toHaveLength(1);
    h = recorded(h, snap(1)); // branched off — the old future is gone
    expect(h.future).toHaveLength(0);
    expect(redone(h, snap(3))).toBeNull();
  });

  it('undo on empty history is null; redo with no future is null', () => {
    expect(undone(emptyHistory, snap(1))).toBeNull();
    expect(redone(emptyHistory, snap(1))).toBeNull();
  });

  it('caps the past at HISTORY_CAP, dropping the oldest', () => {
    let h = emptyHistory;
    for (let i = 0; i < HISTORY_CAP + 10; i++) h = recorded(h, snap(i));
    expect(h.past).toHaveLength(HISTORY_CAP);
    expect(h.past[0]).toEqual(snap(10)); // oldest 10 dropped
  });

  it('multi-step undo walks back through states in order', () => {
    let h = recorded(emptyHistory, snap(1));
    h = recorded(h, snap(2));
    h = recorded(h, snap(3));
    const u1 = undone(h, snap(4));
    expect(u1?.snapshot).toEqual(snap(3));
    const u2 = undone(u1?.history ?? h, snap(3));
    expect(u2?.snapshot).toEqual(snap(2));
    const r1 = redone(u2?.history ?? h, snap(2));
    expect(r1?.snapshot).toEqual(snap(3));
  });
});
