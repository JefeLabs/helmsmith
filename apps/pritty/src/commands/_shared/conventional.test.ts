import { describe, expect, it } from 'vitest';
import {
  applySubjectOverrides,
  formatConventional,
  parseConventional,
  retypeForBranch,
} from './conventional.js';
import { inferLabels } from './labels.js';

describe('parseConventional with a label', () => {
  it('reads label, type, scope, breaking and description', () => {
    expect(parseConventional('WEDMODD-23444 fix(issue-report)!: x')).toEqual({
      label: 'WEDMODD-23444',
      type: 'fix',
      scope: 'issue-report',
      breaking: true,
      description: 'x',
    });
  });

  it('parses an unlabelled subject without a label key', () => {
    const p = parseConventional('fix(a): x');
    expect(p).toEqual({ type: 'fix', scope: 'a', breaking: false, description: 'x' });
    expect(p).not.toHaveProperty('label');
  });
});

describe('formatConventional', () => {
  it.each(['WEDMODD-23444 fix(issue-report)!: x', 'fix(a): x', 'feat: y', 'ABC-1 docs: z'])(
    'round-trips %s',
    (s) => {
      expect(formatConventional(parseConventional(s)!)).toBe(s);
    },
  );
});

describe('label survives rebuilds', () => {
  it('retypeForBranch keeps the label', () => {
    const r = retypeForBranch(
      [{ category: 'app', message: 'ABC-1 feat(x): y', files: [] }],
      'fix/x',
      'conventional',
    );
    expect(r.plan[0]!.message).toBe('ABC-1 fix(x): y');
  });

  it('applySubjectOverrides keeps the label', () => {
    const r = applySubjectOverrides([{ category: 'app', message: 'ABC-1 feat(x): y', files: [] }], {
      scope: 'z',
    });
    expect(r.plan[0]!.message).toBe('ABC-1 feat(z): y');
  });

  it('inferLabels reads labelled subjects', () => {
    expect(inferLabels([{ subject: 'ABC-1 fix(x): y' }, { subject: 'ABC-1 feat(x): z' }])).toEqual([
      'bug',
      'enhancement',
    ]);
  });
});
