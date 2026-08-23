import { describe, expect, it } from 'vitest';
import { calculateSegments, type Segment } from '../aggregator/segments.js';

// Helper to convert Map to plain object for easier assertions
function toObj(map: Map<string, Segment>): Record<string, Segment> {
  return Object.fromEntries(map);
}

describe('calculateSegments', () => {
  it('returns empty map for empty input', () => {
    const result = calculateSegments(new Map());
    expect(result.size).toBe(0);
  });

  it('assigns everyone to middle when the cohort is smaller than minN (default 8)', () => {
    const totals = new Map([
      ['a', 100],
      ['b', 50],
      ['c', 10],
      ['d', 0],
    ]);
    const seg = calculateSegments(totals);
    expect([...seg.values()].every((s) => s === 'middle')).toBe(true);
  });

  it('labels high/low once the cohort reaches minN', () => {
    const totals = new Map(
      Array.from({ length: 8 }, (_, i) => [`m${i}`, (8 - i) * 10] as [string, number]),
    );
    const seg = calculateSegments(totals);
    expect(seg.get('m0')).toBe('high');
    expect(seg.get('m1')).toBe('high');
    expect(seg.get('m7')).toBe('low');
    expect(seg.get('m3')).toBe('middle');
  });

  it('respects a custom minN', () => {
    const totals = new Map([
      ['a', 100],
      ['b', 50],
      ['c', 10],
    ]);
    expect(calculateSegments(totals, undefined, 3).get('a')).toBe('high');
    expect(calculateSegments(totals, undefined, 3).get('c')).toBe('low');
  });

  it('handles exactly 5 members with 20/60/20 split', () => {
    // ceil(5 * 0.20) = 1 high, 1 low, 3 middle
    const result = calculateSegments(
      new Map([
        ['a', 500],
        ['b', 400],
        ['c', 300],
        ['d', 200],
        ['e', 100],
      ]),
      undefined,
      5,
    );
    expect(toObj(result)).toEqual({
      a: 'high',
      b: 'middle',
      c: 'middle',
      d: 'middle',
      e: 'low',
    });
  });

  it('handles 10 members with 20/60/20 split', () => {
    // ceil(10 * 0.20) = 2 high, 2 low, 6 middle
    const members = new Map<string, number>();
    for (let i = 0; i < 10; i++) {
      members.set(`m${i}`, (10 - i) * 100);
    }
    const result = calculateSegments(members);
    expect(result.get('m0')).toBe('high');
    expect(result.get('m1')).toBe('high');
    expect(result.get('m2')).toBe('middle');
    expect(result.get('m7')).toBe('middle');
    expect(result.get('m8')).toBe('low');
    expect(result.get('m9')).toBe('low');
  });

  it('handles 30 members (realistic team size)', () => {
    // ceil(30 * 0.20) = 6 high, 6 low, 18 middle
    const members = new Map<string, number>();
    for (let i = 0; i < 30; i++) {
      members.set(`m${i}`, (30 - i) * 100);
    }
    const result = calculateSegments(members);

    const segments = [...result.values()];
    expect(segments.filter((s) => s === 'high').length).toBe(6);
    expect(segments.filter((s) => s === 'middle').length).toBe(18);
    expect(segments.filter((s) => s === 'low').length).toBe(6);
  });

  it('zero-value members are always low regardless of position', () => {
    const result = calculateSegments(
      new Map([
        ['alice', 500],
        ['bob', 300],
        ['charlie', 200],
        ['dave', 100],
        ['eve', 0],
      ]),
      undefined,
      5,
    );
    expect(result.get('eve')).toBe('low');
  });

  it('multiple zero-value members are all low', () => {
    const result = calculateSegments(
      new Map([
        ['alice', 500],
        ['bob', 300],
        ['charlie', 0],
        ['dave', 0],
        ['eve', 0],
      ]),
      undefined,
      5,
    );
    expect(result.get('charlie')).toBe('low');
    expect(result.get('dave')).toBe('low');
    expect(result.get('eve')).toBe('low');
  });

  it('respects custom thresholds', () => {
    // 10 members with 10/10 thresholds → ceil(10*0.10) = 1 high, 1 low
    const members = new Map<string, number>();
    for (let i = 0; i < 10; i++) {
      members.set(`m${i}`, (10 - i) * 100);
    }
    const result = calculateSegments(members, { high: 10, low: 10 });
    expect(result.get('m0')).toBe('high');
    expect(result.get('m1')).toBe('middle');
    expect(result.get('m8')).toBe('middle');
    expect(result.get('m9')).toBe('low');
  });

  it('handles all members with equal values', () => {
    const result = calculateSegments(
      new Map([
        ['a', 100],
        ['b', 100],
        ['c', 100],
        ['d', 100],
        ['e', 100],
      ]),
      undefined,
      5,
    );
    // With equal values, positions are arbitrary but all 5 must be categorized
    const segments = [...result.values()];
    expect(segments.filter((s) => s === 'high').length).toBe(1);
    expect(segments.filter((s) => s === 'low').length).toBe(1);
    expect(segments.filter((s) => s === 'middle').length).toBe(3);
  });
});
