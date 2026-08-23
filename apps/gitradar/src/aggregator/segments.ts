export type Segment = 'high' | 'middle' | 'low';

export interface SegmentThresholds {
  high: number; // percentage for top tier (default 20)
  low: number; // percentage for bottom tier (default 20)
}

/**
 * Assign a segment (high / middle / low) to each member based on their
 * total metric value within the current set.
 *
 * - N < minN (default 8): a percentile split is not statistically meaningful
 *   on a cohort this small, so everyone is "middle" — no labels at all.
 * - N >= minN: top ceil(N * high%) = high, bottom ceil(N * low%) = low, rest = middle
 * - Members with 0 total are always "low" (once the cohort clears minN)
 *
 * Computation is post-filter: segments reflect the current view, not stored data.
 */
export function calculateSegments(
  memberTotals: Map<string, number>,
  thresholds: SegmentThresholds = { high: 20, low: 20 },
  minN = 8,
): Map<string, Segment> {
  const result = new Map<string, Segment>();
  const entries = [...memberTotals.entries()];
  const n = entries.length;
  if (n === 0) return result;

  // Too few people for a percentile split to mean anything: no labels at all.
  if (n < minN) {
    for (const [name] of entries) result.set(name, 'middle');
    return result;
  }

  entries.sort((a, b) => b[1] - a[1]);
  const highCount = Math.ceil(n * (thresholds.high / 100));
  const lowCount = Math.ceil(n * (thresholds.low / 100));
  for (let i = 0; i < entries.length; i++) {
    const [name, value] = entries[i];
    if (value === 0) result.set(name, 'low');
    else if (i < highCount) result.set(name, 'high');
    else if (i >= n - lowCount) result.set(name, 'low');
    else result.set(name, 'middle');
  }
  return result;
}
