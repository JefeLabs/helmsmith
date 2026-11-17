/** A normalised label: upper-case letters and digits, joined by single hyphens. */
export const LABEL_RE = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

export type LabelResult = { ok: true; label: string } | { ok: false; error: string };

/**
 * Strict normalisation for labels typed or supplied by a caller: trim,
 * upper-case, each run of whitespace becomes one hyphen. Anything else that
 * breaks the grammar is refused rather than converted.
 */
export function normalizeLabel(raw: string): LabelResult {
  const label = raw.trim().toUpperCase().replace(/\s+/g, '-');
  if (label === '') return { ok: false, error: 'label is empty' };
  if (LABEL_RE.test(label)) return { ok: true, label };
  const bad = label.match(/[^A-Z0-9-]/)?.[0] ?? '--';
  return {
    ok: false,
    error: `label "${raw.trim()}" can hold only letters, digits and single hyphens (found "${bad}")`,
  };
}

/**
 * Lenient label for a model-written change name: every run of characters
 * outside [A-Za-z0-9] becomes a hyphen, and a long result is cut at the last
 * hyphen within `max` characters.
 */
export function labelFromChange(change: string | undefined, max = 24): string | undefined {
  if (!change) return undefined;
  let label = change
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (label.length > max) {
    const hyphen = label.slice(0, max + 1).lastIndexOf('-');
    label = label.slice(0, hyphen > 0 ? hyphen : max);
  }
  return label === '' ? undefined : label;
}

const LABELLED = /^([A-Z0-9]+(?:-[A-Z0-9]+)*) ([a-z]+(?:\([^)]*\))?!?:.*)$/s;

/**
 * Split a leading label off a commit subject. Case-sensitive: a label counts
 * only when one space and a lower-case conventional header follow it.
 */
export function splitLabel(subject: string): { label?: string; rest: string } {
  const m = subject.match(LABELLED);
  return m ? { label: m[1]!, rest: m[2]! } : { rest: subject };
}
