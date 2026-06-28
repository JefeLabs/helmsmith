/**
 * Smoke tests for Table — focused on the data-shaping logic that
 * doesn't require a React renderer (the imperative API contract,
 * sort comparator integration, key derivation).
 *
 * Full render tests need an openTUI test harness (see tui-view-components
 * test-utils — not yet wired). For now, validate the pieces.
 */

import { describe, expect, it } from 'vitest';
import type { TableHandle, TableReorderStrategy } from './Table.tsx';

interface TestRow {
  id: string;
  name: string;
  status: 'connected' | 'expired' | 'disconnected';
  priority: number;
}

const rows: TestRow[] = [
  { id: 'a', name: 'Alpha', status: 'connected', priority: 2 },
  { id: 'b', name: 'Bravo', status: 'disconnected', priority: 1 },
  { id: 'c', name: 'Charlie', status: 'expired', priority: 3 },
];

describe('TableHandle (type contract)', () => {
  it('declares all imperative methods', () => {
    const methods: Array<keyof TableHandle<TestRow>> = [
      'updateRow',
      'updateRows',
      'replaceRow',
      'upsertRow',
      'removeRow',
      'replaceAll',
      'markLoading',
      'clearLoading',
      'setLoadingPlaceholders',
      'getRow',
      'getRows',
    ];
    expect(methods).toHaveLength(11);
  });
});

describe('TableReorderStrategy', () => {
  it('stable mode requires no comparator', () => {
    const s: TableReorderStrategy<TestRow> = { mode: 'stable' };
    expect(s.mode).toBe('stable');
  });

  it('sort mode requires a comparator', () => {
    const s: TableReorderStrategy<TestRow> = {
      mode: 'sort',
      compare: (a, b) => a.priority - b.priority,
    };
    expect(s.mode).toBe('sort');
    if (s.mode === 'sort') {
      const sorted = [...rows].sort(s.compare);
      expect(sorted.map((r) => r.id)).toEqual(['b', 'a', 'c']);
    }
  });

  it('sort mode supports cursorFollow option', () => {
    const s: TableReorderStrategy<TestRow> = {
      mode: 'sort',
      compare: (a, b) => a.priority - b.priority,
      cursorFollow: 'row',
    };
    expect(s.mode === 'sort' && s.cursorFollow).toBe('row');
  });

  it('comparator that prioritizes connected > expired > disconnected', () => {
    const order: Record<TestRow['status'], number> = {
      connected: 0,
      expired: 1,
      disconnected: 2,
    };
    const compare = (a: TestRow, b: TestRow) => order[a.status] - order[b.status];
    const sorted = [...rows].sort(compare);
    expect(sorted.map((r) => r.id)).toEqual(['a', 'c', 'b']);
  });
});

describe('Map-based update semantics', () => {
  // These tests validate the Map-update pattern the Table uses
  // internally: stable references for non-touched rows, fresh
  // reference only for the targeted row.

  it("updateRow only changes the targeted row's reference", () => {
    const m = new Map<string, TestRow>();
    for (const r of rows) m.set(r.id, r);

    const original = {
      a: m.get('a'),
      b: m.get('b'),
      c: m.get('c'),
    };

    // Simulate updateRow("b", { status: "connected" })
    const next = new Map(m);
    next.set('b', { ...next.get('b')!, status: 'connected' });

    expect(next.get('a')).toBe(original.a); // same reference
    expect(next.get('c')).toBe(original.c); // same reference
    expect(next.get('b')).not.toBe(original.b); // new reference
    expect(next.get('b')?.status).toBe('connected');
  });

  it('updateRows batch keeps untouched rows stable', () => {
    const m = new Map<string, TestRow>();
    for (const r of rows) m.set(r.id, r);
    const originalA = m.get('a');
    const originalC = m.get('c');

    const next = new Map(m);
    next.set('a', { ...next.get('a')!, status: 'expired' });
    next.set('b', { ...next.get('b')!, status: 'connected' });

    expect(next.get('c')).toBe(originalC); // untouched
    expect(next.get('a')).not.toBe(originalA); // touched
  });

  it('removeRow strips a single key', () => {
    const m = new Map<string, TestRow>();
    for (const r of rows) m.set(r.id, r);
    const next = new Map(m);
    next.delete('b');
    expect(Array.from(next.keys())).toEqual(['a', 'c']);
  });

  it('upsertRow replaces an existing key in place', () => {
    const m = new Map<string, TestRow>();
    for (const r of rows) m.set(r.id, r);
    const next = new Map(m);
    next.set('a', {
      id: 'a',
      name: 'Alpha v2',
      status: 'expired',
      priority: 5,
    });
    expect(Array.from(next.keys())).toEqual(['a', 'b', 'c']); // order preserved
    expect(next.get('a')?.name).toBe('Alpha v2');
  });
});

describe('Loading-key tracking', () => {
  it('markLoading/clearLoading semantics on a Set', () => {
    let loading = new Set<string>();
    // markLoading(["a", "b"])
    loading = new Set(loading);
    loading.add('a');
    loading.add('b');
    expect(loading.has('a')).toBe(true);
    expect(loading.has('b')).toBe(true);
    expect(loading.has('c')).toBe(false);

    // clearLoading("a")
    loading = new Set(loading);
    loading.delete('a');
    expect(loading.has('a')).toBe(false);
    expect(loading.has('b')).toBe(true);

    // clearLoading() — clear all
    loading = new Set();
    expect(loading.size).toBe(0);
  });

  it('updateRow auto-clears the loading flag for that key', () => {
    const loading = new Set(['a', 'b']);
    // Simulating updateRow("a", {...})
    const next = new Set(loading);
    next.delete('a');
    expect(next.has('a')).toBe(false);
    expect(next.has('b')).toBe(true);
  });
});
