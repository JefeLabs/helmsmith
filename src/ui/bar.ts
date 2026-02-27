export interface BarSegment {
  value: number;
  color: (s: string) => string;
  char: string;
}

/**
 * Render an inline stacked bar chart of exactly `width` characters.
 *
 * Each segment gets proportional width. Segments with value > 0 get at least 1 character.
 * The returned string is exactly `width` visible characters (plus ANSI color codes).
 */
export function stackedBar(segments: BarSegment[], width: number): string {
  if (width <= 0) {
    return "";
  }

  const total = segments.reduce((sum, seg) => sum + seg.value, 0);

  if (total === 0) {
    return " ".repeat(width);
  }

  // Filter to segments with value > 0
  const active = segments.filter((seg) => seg.value > 0);

  // Calculate raw proportional widths
  const rawWidths = active.map((seg) => (seg.value / total) * width);

  // Ensure minimum of 1 char per segment, then distribute remainder
  const charWidths = rawWidths.map((raw) => Math.max(1, Math.floor(raw)));

  // Adjust to fill exactly `width` characters
  let allocated = charWidths.reduce((sum, w) => sum + w, 0);

  if (allocated < width) {
    // Distribute remaining chars to segments with the largest fractional parts
    const remainders = rawWidths.map((raw, i) => ({
      index: i,
      remainder: raw - charWidths[i],
    }));
    remainders.sort((a, b) => b.remainder - a.remainder);

    let remaining = width - allocated;
    for (const entry of remainders) {
      if (remaining <= 0) break;
      charWidths[entry.index]++;
      remaining--;
    }
  } else if (allocated > width) {
    // Remove excess chars from segments with the smallest fractional parts
    const remainders = rawWidths.map((raw, i) => ({
      index: i,
      remainder: raw - charWidths[i],
    }));
    // Sort ascending by remainder (smallest fractional part first)
    remainders.sort((a, b) => a.remainder - b.remainder);

    let excess = allocated - width;
    for (const entry of remainders) {
      if (excess <= 0) break;
      // Don't reduce below 1
      if (charWidths[entry.index] > 1) {
        charWidths[entry.index]--;
        excess--;
      }
    }
  }

  // Build the colored bar
  const parts = active.map((seg, i) => {
    const chars = seg.char.repeat(charWidths[i]);
    return seg.color(chars);
  });

  return parts.join("");
}
