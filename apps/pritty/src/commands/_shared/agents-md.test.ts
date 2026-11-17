import { describe, expect, it } from 'vitest';
import { AGENTS_BEGIN, AGENTS_END, upsertSection } from './agents-md.js';

function text(existing: string | undefined, section: string): string {
  const r = upsertSection(existing, section);
  if (!r.ok) throw new Error(r.problem);
  return r.text;
}

describe('upsertSection', () => {
  it('wraps the section in the markers when there is no file', () => {
    expect(text(undefined, 'X\n')).toBe(`${AGENTS_BEGIN}\nX\n${AGENTS_END}\n`);
  });

  it('appends after a blank line, keeping the existing text', () => {
    expect(text('# Mine\n\nkeep\n', 'X\n').startsWith(`# Mine\n\nkeep\n\n${AGENTS_BEGIN}`)).toBe(
      true,
    );
    expect(text('# Mine', 'X\n').startsWith(`# Mine\n\n${AGENTS_BEGIN}`)).toBe(true);
    expect(text('# Mine\n\n\n', 'X\n').startsWith(`# Mine\n\n${AGENTS_BEGIN}`)).toBe(true);
  });

  it('replaces only the text between the markers on a second run', () => {
    const withAfter = `${text('# Mine\n', 'old\n')}\nafter\n`;
    const second = text(withAfter, 'new\n');
    expect(second).toBe(`# Mine\n\n${AGENTS_BEGIN}\nnew\n${AGENTS_END}\n\nafter\n`);
  });

  const broken: Record<string, string> = {
    'only begin': `# Mine\n${AGENTS_BEGIN}\nuser text\n`,
    'only end': `# Mine\n${AGENTS_END}\nuser text\n`,
    'end before begin': `a\n${AGENTS_END}\nb\n${AGENTS_BEGIN}\nc\n`,
    'two begin markers': `${AGENTS_BEGIN}\nx\n${AGENTS_BEGIN}\ny\n${AGENTS_END}\n`,
    'two full pairs': `${AGENTS_BEGIN}\nx\n${AGENTS_END}\nmid\n${AGENTS_BEGIN}\ny\n${AGENTS_END}\n`,
  };
  for (const [name, input] of Object.entries(broken)) {
    it(`reports a problem and produces no text for: ${name}`, () => {
      const r = upsertSection(input, 'new\n');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.problem).toMatch(/marker/i);
    });
  }
});
