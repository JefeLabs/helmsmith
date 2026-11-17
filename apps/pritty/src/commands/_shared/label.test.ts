import { describe, expect, it } from 'vitest';
import { labelFromChange, normalizeLabel, splitLabel } from './label.js';

describe('normalizeLabel', () => {
  it.each([
    ['status logging', 'STATUS-LOGGING'],
    ['wedmodd-23444', 'WEDMODD-23444'],
    ['  Status   Logging ', 'STATUS-LOGGING'],
    ['Wedmodd-23444', 'WEDMODD-23444'],
  ])('normalises %j to %s', (raw, label) => {
    expect(normalizeLabel(raw)).toEqual({ ok: true, label });
  });

  it.each(['', '   ', 'a--b', 'fix.'])('refuses %j', (raw) => {
    expect(normalizeLabel(raw).ok).toBe(false);
  });

  it('names the offending character', () => {
    const under = normalizeLabel('wedmodd_23444');
    expect(under.ok === false && under.error).toContain('_');
    const slash = normalizeLabel('family/help');
    expect(slash.ok === false && slash.error).toContain('/');
  });
});

describe('labelFromChange', () => {
  it('upper-cases and hyphenates', () => {
    expect(labelFromChange('login rate limit')).toBe('LOGIN-RATE-LIMIT');
    expect(labelFromChange("users' phone/email")).toBe('USERS-PHONE-EMAIL');
  });

  it('cuts long names at a hyphen', () => {
    const label = labelFromChange('a very long change name that keeps going');
    expect(label).toBe('A-VERY-LONG-CHANGE-NAME');
    expect(label?.endsWith('-')).toBe(false);
  });

  it('returns undefined when nothing is left', () => {
    expect(labelFromChange('  ')).toBeUndefined();
    expect(labelFromChange(undefined)).toBeUndefined();
  });
});

describe('splitLabel', () => {
  it('splits a leading label', () => {
    expect(splitLabel('WEDMODD-23444 fix(issue-report): x')).toEqual({
      label: 'WEDMODD-23444',
      rest: 'fix(issue-report): x',
    });
    expect(splitLabel('API fix: x')).toEqual({ label: 'API', rest: 'fix: x' });
  });

  it('leaves unlabelled subjects alone', () => {
    expect(splitLabel('fix(api): x')).toEqual({ rest: 'fix(api): x' });
    expect(splitLabel('Merge branch develop')).toEqual({ rest: 'Merge branch develop' });
    expect(splitLabel('wedmodd-1 fix: x')).toEqual({ rest: 'wedmodd-1 fix: x' });
  });
});
