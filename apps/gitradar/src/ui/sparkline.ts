const SPARK_CHARS = [
  "\u2581", // ▁
  "\u2582", // ▂
  "\u2583", // ▃
  "\u2584", // ▄
  "\u2585", // ▅
  "\u2586", // ▆
  "\u2587", // ▇
  "\u2588", // █
];

export interface SparklineOptions {
  /** Optional color function to apply to the sparkline characters. */
  color?: (s: string) => string;
}

/**
 * Render an inline sparkline from an array of numeric values.
 * Uses block characters ▁▂▃▄▅▆▇█ mapped proportionally.
 *
 * Empty arrays return an empty string.
 * Single values render as a mid-height bar.
 * All-same values render as mid-height bars.
 */
export function sparkline(
  values: number[],
  options?: SparklineOptions
): string {
  if (values.length === 0) {
    return "";
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  const chars = values.map((v) => {
    if (range === 0) {
      // All values the same (or single value) — use middle bar
      return SPARK_CHARS[3];
    }
    // Map value to index 0..7
    const normalized = (v - min) / range;
    const index = Math.min(
      SPARK_CHARS.length - 1,
      Math.floor(normalized * (SPARK_CHARS.length - 1))
    );
    return SPARK_CHARS[index];
  });

  const result = chars.join("");

  if (options?.color) {
    return options.color(result);
  }

  return result;
}
