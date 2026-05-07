export type Segment = 'high' | 'middle' | 'low';

export interface SegmentThresholds {
  high: number;  // percentage for top tier (default 20)
  low: number;   // percentage for bottom tier (default 20)
}

/**
 * Assign a segment (high / middle / low) to each member based on their
 * total metric value within the current set.
 *
 * - N >= 5: top ceil(N * high%) = high, bottom ceil(N * low%) = low, rest = middle
 * - N < 5:  top 1 = high, bottom 1 = low, rest = middle
 * - Members with 0 total are always "low"
 *
 * Computation is post-filter: segments reflect the current view, not stored data.
 */
export function calculateSegments(
  memberTotals: Map<string, number>,
  thresholds: SegmentThresholds = { high: 20, low: 20 },
): Map<string, Segment> {
  const result = new Map<string, Segment>();
  const entries = [...memberTotals.entries()];
  const n = entries.length;

  if (n === 0) return result;

  // Single member is always high
  if (n === 1) {
    const [name, value] = entries[0];
    result.set(name, value === 0 ? 'low' : 'high');
    return result;
  }

  // Sort descending by value
  entries.sort((a, b) => b[1] - a[1]);

  // Determine tier sizes
  let highCount: number;
  let lowCount: number;

  if (n < 5) {
    // Small-N fallback: top 1, bottom 1, rest middle
    highCount = 1;
    lowCount = 1;
  } else {
    highCount = Math.ceil(n * (thresholds.high / 100));
    lowCount = Math.ceil(n * (thresholds.low / 100));
  }

  for (let i = 0; i < entries.length; i++) {
    const [name, value] = entries[i];

    // Zero-value members are always low
    if (value === 0) {
      result.set(name, 'low');
      continue;
    }

    if (i < highCount) {
      result.set(name, 'high');
    } else if (i >= n - lowCount) {
      result.set(name, 'low');
    } else {
      result.set(name, 'middle');
    }
  }

  return result;
}
