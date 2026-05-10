import chalk from 'chalk';
import Handlebars from 'handlebars';

/** Default status-to-badge mapping (standard preset fallback). */
const STATUS_BADGES: Record<string, { icon: string; color: (s: string) => string }> = {
  done: { icon: '\u2713', color: chalk.green },
  'in-progress': { icon: '\u25CB', color: chalk.yellow },
  review: { icon: '\u25CB', color: chalk.yellow },
  blocked: { icon: '\u2718', color: chalk.red },
  todo: { icon: '\u2022', color: chalk.gray },
  backlog: { icon: '\u2022', color: chalk.gray },
  ready: { icon: '\u25CB', color: chalk.cyan },
  testing: { icon: '\u25CB', color: chalk.yellow },
  'on-hold': { icon: '\u25CB', color: chalk.gray },
};

/** Default category-to-badge fallback for unknown statuses. */
const _CATEGORY_BADGES: Record<string, { icon: string; color: (s: string) => string }> = {
  open: { icon: '\u2022', color: chalk.gray },
  active: { icon: '\u25CB', color: chalk.yellow },
  closed: { icon: '\u2713', color: chalk.green },
};

/**
 * Register all custom Handlebars helpers on the global Handlebars instance.
 */
export function registerHelpers(): void {
  Handlebars.registerHelper('complexity-color', complexityColor);
  Handlebars.registerHelper('status-badge', statusBadge);
  Handlebars.registerHelper('progress-bar', progressBar);
  Handlebars.registerHelper('date-format', dateFormat);
  Handlebars.registerHelper('pluralize', pluralize);
  Handlebars.registerHelper('indent', indent);
  Handlebars.registerHelper('if-gte', ifGte);
  Handlebars.registerHelper('if-lte', ifLte);
  Handlebars.registerHelper('if-gt', ifGt);
  Handlebars.registerHelper('if-lt', ifLt);
  Handlebars.registerHelper('if-eq', ifEq);
  Handlebars.registerHelper('join', join);
}

/**
 * Returns a color-coded complexity score indicator.
 * 1-3: green (Low), 4-6: yellow (Medium), 7-10: red (High)
 */
export function complexityColor(score: unknown): string {
  const n = Number(score);
  if (Number.isNaN(n)) return String(score);

  if (n <= 3) return chalk.green(`${n}`);
  if (n <= 6) return chalk.yellow(`${n}`);
  return chalk.red(`${n}`);
}

/**
 * Returns a formatted status badge with unicode indicator and color.
 * Uses hardcoded standard preset mapping as default.
 */
export function statusBadge(status: unknown): string {
  const s = String(status);
  const badge = STATUS_BADGES[s];

  if (badge) {
    return badge.color(`${badge.icon} ${s}`);
  }

  // Fallback for unknown statuses
  return chalk.gray(`\u2022 ${s}`);
}

/**
 * Renders a 20-character ASCII progress bar with percentage.
 * Example: [########............] 40%
 */
export function progressBar(done: unknown, total: unknown): string {
  const d = Number(done);
  const t = Number(total);

  if (Number.isNaN(d) || Number.isNaN(t) || t === 0) {
    return '[....................] 0%';
  }

  const percentage = Math.max(0, Math.min(100, Math.round((d / t) * 100)));
  const barWidth = 20;
  const filled = Math.round((percentage / 100) * barWidth);
  const empty = barWidth - filled;

  const filledStr = chalk.green('\u2588'.repeat(filled));
  const emptyStr = chalk.dim('\u2591'.repeat(empty));

  return `[${filledStr}${emptyStr}] ${percentage}%`;
}

/**
 * Formats an ISO date string using simple pattern replacement.
 * Supports: YYYY, MM, DD, HH, mm, ss
 */
export function dateFormat(dateStr: unknown, format: unknown): string {
  const s = String(dateStr);
  const fmt = typeof format === 'string' ? format : 'YYYY-MM-DD';

  const date = new Date(s);
  if (Number.isNaN(date.getTime())) return s;

  const tokens: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    MM: String(date.getMonth() + 1).padStart(2, '0'),
    DD: String(date.getDate()).padStart(2, '0'),
    HH: String(date.getHours()).padStart(2, '0'),
    mm: String(date.getMinutes()).padStart(2, '0'),
    ss: String(date.getSeconds()).padStart(2, '0'),
  };

  let result = fmt;
  // Replace longest tokens first to avoid partial matches
  for (const [token, value] of Object.entries(tokens)) {
    result = result.replace(new RegExp(token, 'g'), value);
  }

  return result;
}

/**
 * Conditional singular/plural text.
 */
export function pluralize(count: unknown, singular: unknown, plural: unknown): string {
  const n = Number(count);
  return n === 1 ? String(singular) : String(plural);
}

/**
 * Indents multiline text by N levels (2 spaces per level).
 */
export function indent(text: unknown, level: unknown): string {
  const s = String(text);
  const n = Number(level);
  if (Number.isNaN(n) || n <= 0) return s;

  const prefix = '  '.repeat(n);
  return s
    .split('\n')
    .map((line) => prefix + line)
    .join('\n');
}

// --- Block comparison helpers ---
// These must be regular functions (not arrow functions) so Handlebars can bind `this`.

export function ifGte(
  this: unknown,
  a: unknown,
  b: unknown,
  options: Handlebars.HelperOptions,
): string {
  return Number(a) >= Number(b) ? options.fn(this) : options.inverse(this);
}

export function ifLte(
  this: unknown,
  a: unknown,
  b: unknown,
  options: Handlebars.HelperOptions,
): string {
  return Number(a) <= Number(b) ? options.fn(this) : options.inverse(this);
}

export function ifGt(
  this: unknown,
  a: unknown,
  b: unknown,
  options: Handlebars.HelperOptions,
): string {
  return Number(a) > Number(b) ? options.fn(this) : options.inverse(this);
}

export function ifLt(
  this: unknown,
  a: unknown,
  b: unknown,
  options: Handlebars.HelperOptions,
): string {
  return Number(a) < Number(b) ? options.fn(this) : options.inverse(this);
}

export function ifEq(
  this: unknown,
  a: unknown,
  b: unknown,
  options: Handlebars.HelperOptions,
): string {
  return a === b ? options.fn(this) : options.inverse(this);
}

/**
 * Join an array of strings with a separator.
 */
export function join(arr: unknown, separator: unknown): string {
  if (!Array.isArray(arr)) return String(arr ?? '');
  return arr.join(typeof separator === 'string' ? separator : ', ');
}
