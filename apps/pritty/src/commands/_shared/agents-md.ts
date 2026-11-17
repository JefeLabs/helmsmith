/** Markers around the section `pritty init` manages inside AGENTS.md. */
export const AGENTS_BEGIN =
  '<!-- pritty:begin (managed by `pritty init`; edits inside are replaced) -->';
export const AGENTS_END = '<!-- pritty:end -->';

export type UpsertResult = { ok: true; text: string } | { ok: false; problem: string };

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/**
 * Put `section` between the markers: replace what is between them when the
 * file holds exactly one begin and one end marker in that order (nothing else
 * changes), append after a blank line when it holds none. Any other marker
 * state is reported as a problem, never rewritten. A returned text always
 * ends with a newline.
 */
export function upsertSection(existing: string | undefined, section: string): UpsertResult {
  const body = section.endsWith('\n') ? section : `${section}\n`;
  const block = `${AGENTS_BEGIN}\n${body}${AGENTS_END}`;
  if (existing === undefined) return { ok: true, text: `${block}\n` };
  const begins = count(existing, AGENTS_BEGIN);
  const ends = count(existing, AGENTS_END);
  if (begins === 0 && ends === 0) {
    const trimmed = existing.replace(/\n+$/, '');
    return { ok: true, text: trimmed.length === 0 ? `${block}\n` : `${trimmed}\n\n${block}\n` };
  }
  const start = existing.indexOf(AGENTS_BEGIN);
  const end = existing.indexOf(AGENTS_END);
  if (begins !== 1 || ends !== 1 || end < start) {
    return {
      ok: false,
      problem: `found ${begins} pritty:begin and ${ends} pritty:end marker(s)${
        begins === 1 && ends === 1 ? ' in the wrong order' : ''
      }; expected exactly one of each, begin first`,
    };
  }
  const next = `${existing.slice(0, start)}${block}${existing.slice(end + AGENTS_END.length)}`;
  return { ok: true, text: next.endsWith('\n') ? next : `${next}\n` };
}
