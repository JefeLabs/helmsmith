import chalk from "chalk";

/**
 * Format a number for compact display.
 * 1234 -> "1.2K", 1234567 -> "1.2M", <1000 -> as-is
 */
export function fmt(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`;
  }
  return String(n);
}

/**
 * Format a delta between current and previous values.
 * Returns a colored string with direction indicator.
 * chalk.green("▲ 12%") or chalk.red("▼ 8%") or chalk.dim("─ 0%")
 */
export function delta(curr: number, prev: number): string {
  if (prev === 0 && curr === 0) {
    return chalk.dim("\u2500 0%");
  }
  if (prev === 0) {
    return chalk.green("\u25B2 new");
  }

  const pct = Math.round(((curr - prev) / prev) * 100);

  if (pct > 0) {
    return chalk.green(`\u25B2 ${pct}%`);
  }
  if (pct < 0) {
    return chalk.red(`\u25BC ${Math.abs(pct)}%`);
  }
  return chalk.dim("\u2500 0%");
}

/**
 * Convert ISO week string to a human-readable label.
 * "2026-W08" -> "Feb 17" (Monday of that ISO week)
 */
export function weekLabel(w: string): string {
  const match = w.match(/^(\d{4})-W(\d{2})$/);
  if (!match) {
    return w;
  }

  const year = parseInt(match[1], 10);
  const week = parseInt(match[2], 10);

  // ISO week date to calendar date
  // Jan 4 is always in ISO week 1
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7; // Convert Sunday=0 to 7
  // Monday of ISO week 1
  const mondayOfWeek1 = new Date(jan4);
  mondayOfWeek1.setDate(jan4.getDate() - (dayOfWeek - 1));
  // Monday of the target week
  const monday = new Date(mondayOfWeek1);
  monday.setDate(mondayOfWeek1.getDate() + (week - 1) * 7);

  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  return `${months[monday.getMonth()]} ${monday.getDate()}`;
}

/**
 * Extract short week identifier.
 * "2026-W08" -> "W08"
 */
export function weekShort(w: string): string {
  const match = w.match(/^(\d{4})-(W\d{2})$/);
  if (!match) {
    return w;
  }
  return match[2];
}

/**
 * Format a quarter string "YYYY-Qn" into a short label like "Q1 '26".
 */
export function quarterShort(quarter: string): string {
  const match = quarter.match(/^(\d{4})-(Q\d)$/);
  if (!match) return quarter;
  return `${match[2]} '${match[1].slice(2)}`;
}

/**
 * Format a year string "YYYY" into a short label like "'26".
 */
export function yearShort(year: string): string {
  if (year.length !== 4) return year;
  return `'${year.slice(2)}`;
}

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

/**
 * Strip ANSI escape codes from a string.
 */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_REGEX, "");
}

/**
 * ANSI-aware right padding.
 * Pads the visible (non-ANSI) content to the given width.
 */
export function padRight(s: string, n: number): string {
  const visibleLength = stripAnsi(s).length;
  if (visibleLength >= n) {
    return s;
  }
  return s + " ".repeat(n - visibleLength);
}

/**
 * ANSI-aware left padding.
 * Pads the visible (non-ANSI) content to the given width.
 */
export function padLeft(s: string, n: number): string {
  const visibleLength = stripAnsi(s).length;
  if (visibleLength >= n) {
    return s;
  }
  return " ".repeat(n - visibleLength) + s;
}
