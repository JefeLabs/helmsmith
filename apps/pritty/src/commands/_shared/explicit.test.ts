import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES } from '../../categorizer.js';
import { type ExplicitCommit, parseCommitInput, planExplicit } from './explicit.js';

const STAGED = ['src/a.ts', 'src/a.test.ts', 'src/b.ts'];

function ctx(over: { labelsRequired?: boolean; staged?: string[] } = {}) {
  const staged = over.staged ?? STAGED;
  return {
    staged,
    matched: new Map<string, readonly string[]>(),
    categories: DEFAULT_CATEGORIES,
    labelsRequired: over.labelsRequired ?? false,
  };
}

/** Plan with `matched` derived from exact paths (each path names itself when staged). */
function plan(commits: ExplicitCommit[], over: Parameters<typeof ctx>[0] = {}) {
  const c = ctx(over);
  for (const commit of commits) {
    for (const p of commit.paths ?? []) c.matched.set(p, c.staged.includes(p) ? [p] : []);
  }
  return planExplicit(commits, c);
}

const fix = (over: Partial<ExplicitCommit> = {}): ExplicitCommit => ({
  type: 'fix',
  scope: 'api',
  description: 'handle 404',
  paths: ['src/a.ts'],
  ...over,
});

describe('planExplicit', () => {
  it('plans one commit', () => {
    expect(plan([fix()])).toEqual({
      plan: [{ category: 'app', message: 'fix(api): handle 404', files: ['src/a.ts'] }],
      warnings: [],
    });
  });

  it('normalises the label and keeps the body', () => {
    const { plan: p } = plan([fix({ label: 'wedmodd 23444', body: 'why' })]);
    expect(p[0]).toMatchObject({ label: 'WEDMODD-23444', body: 'why' });
  });

  it('takes every staged file for a single commit without paths, refuses it for several', () => {
    const one = plan([fix({ paths: undefined })], { staged: ['src/a.ts', 'src/b.ts'] });
    expect(one.plan[0]!.files).toEqual(['src/a.ts', 'src/b.ts']);
    expect(() => plan([fix({ paths: undefined }), fix()])).toThrow(/commit 1.*lists no files/);
  });

  it.each([
    [{ label: 'a/b' }, /label/],
    [{ type: 'wibble' }, /type/],
    [{ scope: 'Bad Scope' }, /scope/],
    [{ description: '' }, /description/],
    [{ description: 'Handle 404' }, /capital/],
    [{ description: 'handle 404.' }, /full stop|"\."/],
    [{ description: 'fix(api): handle 404' }, /already|conventional/],
    [{ paths: ['src/zzz.ts'] }, /src\/zzz\.ts matches no staged file/],
    [{ paths: ['src/a.ts', 'src/a.test.ts'] }, /test \(src\/a\.test\.ts\).*app \(src\/a\.ts\)/],
    [{ paths: ['src/a.test.ts'] }, /test.*type/],
    [{ type: 'test' }, /test/],
  ] as Array<[Partial<ExplicitCommit>, RegExp]>)('refuses %j', (over, fragment) => {
    expect(() => plan([fix(over)])).toThrow(fragment);
  });

  it('puts `!` after the scope of a breaking commit', () => {
    const { plan: p } = plan([fix({ label: 'abc 1', breaking: true })]);
    expect(p[0]).toMatchObject({ label: 'ABC-1', message: 'fix(api)!: handle 404' });
  });

  it('lets an acronym start a description', () => {
    expect(() => plan([fix({ description: 'API errors surface' })])).not.toThrow();
  });

  it('requires a label when labelsRequired', () => {
    expect(() => plan([fix()], { labelsRequired: true })).toThrow(
      '--label is required: this repository sets commitLabels',
    );
  });

  it('refuses a file in two commits, naming both positions', () => {
    expect(() => plan([fix(), fix({ description: 'again' })])).toThrow(/src\/a\.ts.*1.*2/);
  });

  it('collects every problem, with positions when there are several commits', () => {
    let message = '';
    try {
      plan([fix({ type: 'nope' }), fix({ scope: 'Bad', paths: ['src/b.ts'] })]);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/commit 1.*type/);
    expect(message).toMatch(/commit 2.*scope/);
    expect(message.split('\n').length).toBeGreaterThanOrEqual(2);
  });

  it('puts code before its tests inside a label, labels in first-appearance order', () => {
    const { plan: p } = plan([
      fix({ label: 'B-1', type: 'test', description: 'cover a', paths: ['src/a.test.ts'] }),
      fix({ label: 'A-1', paths: ['src/a.ts'] }),
      fix({ label: 'B-1', description: 'fix b', paths: ['src/b.ts'] }),
    ]);
    expect(p.map((c) => [c.label, c.category])).toEqual([
      ['B-1', 'app'],
      ['B-1', 'test'],
      ['A-1', 'app'],
    ]);
  });

  it('warns about a subject over 72 characters', () => {
    const { warnings } = plan([fix({ description: 'x'.repeat(70) })]);
    expect(warnings).toEqual([
      expect.stringMatching(/^subject is \d+ characters; aim for 72 or fewer$/),
    ]);
  });
});

describe('parseCommitInput', () => {
  it('maps files to paths and ignores output-only and unknown keys', () => {
    const text = JSON.stringify({
      dryRun: true,
      extra: 1,
      commits: [
        {
          label: 'X-1',
          type: 'fix',
          scope: 'api',
          description: 'd',
          files: ['a'],
          message: 'm',
          category: 'app',
          sha: 'abc',
          other: 2,
        },
      ],
    });
    expect(parseCommitInput(text)).toEqual([
      { label: 'X-1', type: 'fix', scope: 'api', description: 'd', paths: ['a'] },
    ]);
  });

  it('keeps breaking: true, drops breaking: false, and refuses a breaking that is not a boolean', () => {
    const one = (breaking: unknown) =>
      JSON.stringify({ commits: [{ type: 'feat', scope: 'api', description: 'd', breaking }] });
    expect(parseCommitInput(one(true))).toEqual([
      { type: 'feat', scope: 'api', description: 'd', breaking: true },
    ]);
    expect(parseCommitInput(one(false))).toEqual([
      { type: 'feat', scope: 'api', description: 'd' },
    ]);
    expect(() => parseCommitInput(one('yes'))).toThrow(/commits\.0\.breaking/);
  });

  it.each(['', 'nope', '  '])('rejects %j as not a JSON document', (text) => {
    expect(() => parseCommitInput(text)).toThrow(
      'expected a JSON document on stdin: { "commits": [...] }',
    );
  });

  it('lists every shape problem in one error', () => {
    expect(() => parseCommitInput(JSON.stringify({ commits: [{ type: 1 }, {}] }))).toThrow(
      /commits.*0.*\n.*commits.*1/s,
    );
    expect(() => parseCommitInput('{"commits": []}')).toThrow(/commits/);
  });
});
