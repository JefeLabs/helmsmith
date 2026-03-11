import { describe, it, expect } from 'vitest';
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

  it('assigns single member as high (non-zero)', () => {
    const result = calculateSegments(new Map([['alice', 100]]));
    expect(toObj(result)).toEqual({ alice: 'high' });
  });

  it('assigns single member with 0 as low', () => {
    const result = calculateSegments(new Map([['alice', 0]]));
    expect(toObj(result)).toEqual({ alice: 'low' });
  });

  it('handles 2 members: top=high, bottom=low', () => {
    const result = calculateSegments(new Map([['alice', 200], ['bob', 50]]));
    expect(toObj(result)).toEqual({ alice: 'high', bob: 'low' });
  });

  it('handles 3 members (N<5): top 1=high, bottom 1=low, rest=middle', () => {
    const result = calculateSegments(new Map([
      ['alice', 300], ['bob', 200], ['charlie', 100],
    ]));
    expect(toObj(result)).toEqual({
      alice: 'high',
      bob: 'middle',
      charlie: 'low',
    });
  });

  it('handles 4 members (N<5): top 1=high, bottom 1=low, rest=middle', () => {
    const result = calculateSegments(new Map([
      ['alice', 400], ['bob', 300], ['charlie', 200], ['dave', 100],
    ]));
    expect(toObj(result)).toEqual({
      alice: 'high',
      bob: 'middle',
      charlie: 'middle',
      dave: 'low',
    });
  });

  it('handles exactly 5 members with 20/60/20 split', () => {
    // ceil(5 * 0.20) = 1 high, 1 low, 3 middle
    const result = calculateSegments(new Map([
      ['a', 500], ['b', 400], ['c', 300], ['d', 200], ['e', 100],
    ]));
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
    const result = calculateSegments(new Map([
      ['alice', 500], ['bob', 300], ['charlie', 200],
      ['dave', 100], ['eve', 0],
    ]));
    expect(result.get('eve')).toBe('low');
  });

  it('multiple zero-value members are all low', () => {
    const result = calculateSegments(new Map([
      ['alice', 500], ['bob', 300], ['charlie', 0],
      ['dave', 0], ['eve', 0],
    ]));
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
    const result = calculateSegments(new Map([
      ['a', 100], ['b', 100], ['c', 100], ['d', 100], ['e', 100],
    ]));
    // With equal values, positions are arbitrary but all 5 must be categorized
    const segments = [...result.values()];
    expect(segments.filter((s) => s === 'high').length).toBe(1);
    expect(segments.filter((s) => s === 'low').length).toBe(1);
    expect(segments.filter((s) => s === 'middle').length).toBe(3);
  });
});
