/** Markers around the section `pritty init` manages inside AGENTS.md. */
export const AGENTS_BEGIN =
  '<!-- pritty:begin (managed by `pritty init`; edits inside are replaced) -->';
export const AGENTS_END = '<!-- pritty:end -->';

/**
 * Put `section` between the markers: replace what is between them when
 * present (nothing else changes), else append after a blank line. The result
 * always ends with a newline.
 */
export function upsertSection(existing: string | undefined, section: string): string {
  const body = section.endsWith('\n') ? section : `${section}\n`;
  const block = `${AGENTS_BEGIN}\n${body}${AGENTS_END}`;
  if (existing === undefined) return `${block}\n`;
  const start = existing.indexOf(AGENTS_BEGIN);
  const end = start >= 0 ? existing.indexOf(AGENTS_END, start) : -1;
  if (start >= 0 && end >= 0) {
    const next = `${existing.slice(0, start)}${block}${existing.slice(end + AGENTS_END.length)}`;
    return next.endsWith('\n') ? next : `${next}\n`;
  }
  const trimmed = existing.replace(/\n+$/, '');
  return trimmed.length === 0 ? `${block}\n` : `${trimmed}\n\n${block}\n`;
}
