import { describe, expect, it } from 'vitest';
import { AGENTS_BEGIN, AGENTS_END, upsertSection } from './agents-md.js';

describe('upsertSection', () => {
  it('wraps the section in the markers when there is no file', () => {
    expect(upsertSection(undefined, 'X\n')).toBe(`${AGENTS_BEGIN}\nX\n${AGENTS_END}\n`);
  });

  it('appends after a blank line, keeping the existing text', () => {
    expect(
      upsertSection('# Mine\n\nkeep\n', 'X\n').startsWith(`# Mine\n\nkeep\n\n${AGENTS_BEGIN}`),
    ).toBe(true);
    expect(upsertSection('# Mine', 'X\n').startsWith(`# Mine\n\n${AGENTS_BEGIN}`)).toBe(true);
    expect(upsertSection('# Mine\n\n\n', 'X\n').startsWith(`# Mine\n\n${AGENTS_BEGIN}`)).toBe(true);
  });

  it('replaces only the text between the markers on a second run', () => {
    const first = upsertSection('# Mine\n', 'old\n');
    const withAfter = `${first}\nafter\n`;
    const second = upsertSection(withAfter, 'new\n');
    expect(second).toBe(`# Mine\n\n${AGENTS_BEGIN}\nnew\n${AGENTS_END}\n\nafter\n`);
    expect(second.split(AGENTS_BEGIN)).toHaveLength(2);
  });
});
