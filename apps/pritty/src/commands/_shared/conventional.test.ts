import { describe, expect, it } from 'vitest';
import {
  addSharedLabel,
  applySubjectOverrides,
  formatConventional,
  labelledPrTitle,
  parseConventional,
  retypeForBranch,
  sharedLabel,
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

describe('sharedLabel and the PR title it makes', () => {
  const commits = [
    { subject: 'ABC-1 test(issue-report): b' },
    { subject: 'ABC-1 fix(issue-report): a' },
    { subject: "Merge remote-tracking branch 'origin/develop'", merge: true },
  ];
  const shared = { label: 'ABC-1', tags: ['fix', 'test', 'issue-report'] };

  it('finds the one label, skipping merges, with types by rank then scopes', () => {
    expect(sharedLabel(commits)).toEqual(shared);
  });

  it('orders scopes by first use, oldest first', () => {
    expect(sharedLabel([{ subject: 'A-1 fix(b): y' }, { subject: 'A-1 fix(a): x' }])).toEqual({
      label: 'A-1',
      tags: ['fix', 'a', 'b'],
    });
  });

  it('is null for an unlabelled commit, mixed labels or no commits', () => {
    expect(sharedLabel([{ subject: 'fix(a): x' }])).toBeNull();
    expect(sharedLabel([{ subject: 'A-1 fix: x' }, { subject: 'B-2 fix: y' }])).toBeNull();
    expect(sharedLabel([{ subject: 'A-1 fix: x' }, { subject: 'fix: y' }])).toBeNull();
    expect(sharedLabel([])).toBeNull();
  });

  it('writes the label, the summary and the tags', () => {
    expect(labelledPrTitle('fix(api): Stop logging exception text', shared)).toBe(
      'ABC-1: stop logging exception text [fix] [test] [issue-report]',
    );
    expect(labelledPrTitle('ABC-1: Stop it', shared)).toBe(
      'ABC-1: stop it [fix] [test] [issue-report]',
    );
  });

  it('adds the label and missing tags to a given title, idempotently', () => {
    const once = addSharedLabel('ABC-1: my words [fix]', shared);
    expect(once).toBe('ABC-1: my words [fix] [test] [issue-report]');
    expect(addSharedLabel(once, shared)).toBe(once);
    expect(addSharedLabel('my words', shared)).toBe('ABC-1: my words [fix] [test] [issue-report]');
  });
});
