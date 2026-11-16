import { describe, expect, it } from 'vitest';
import type { CommitMessage } from '../../ai.js';
import { reconcileCommitPlan } from './plan.js';

const grouped = { app: ['src/a.ts', 'src/b.ts'], test: ['src/a.test.ts'], docs: [], unknown: [] };

describe('reconcileCommitPlan', () => {
  it("replaces the model's file lists with the categorizer's, ignoring anything it added", () => {
    const plan = reconcileCommitPlan(
      [
        { category: 'app', message: 'feat: a', files: ['src/a.ts', 'secret.env'] },
        { category: 'test', message: 'test: a', body: 'why', files: [] },
      ],
      grouped,
    );
    expect(plan).toEqual([
      { category: 'app', message: 'feat: a', files: ['src/a.ts', 'src/b.ts'] },
      { category: 'test', message: 'test: a', body: 'why', files: ['src/a.test.ts'] },
    ]);
  });

  it('rejects a category the categorizer did not produce', () => {
    expect(() =>
      reconcileCommitPlan(
        [
          { category: 'app', message: 'm', files: [] },
          { category: 'test', message: 'm', files: [] },
          { category: 'infra', message: 'm', files: ['Dockerfile'] },
        ],
        grouped,
      ),
    ).toThrow(/infra/);
  });

  it('pairs the one name it did not produce with the one category with staged files nothing claimed, and says so', () => {
    const renames: Array<[string, string]> = [];
    const plan = reconcileCommitPlan(
      [
        { category: 'feature', message: 'feat: a', files: [] },
        { category: 'test', message: 'test: a', files: [] },
      ],
      grouped,
      (from, to) => renames.push([from, to]),
    );
    expect(plan).toEqual([
      { category: 'app', message: 'feat: a', files: ['src/a.ts', 'src/b.ts'] },
      { category: 'test', message: 'test: a', files: ['src/a.test.ts'] },
    ]);
    expect(renames).toEqual([['feature', 'app']]);
  });

  it('still rejects a name it did not produce when two categories with staged files are unclaimed', () => {
    const g = { app: ['src/a.ts'], config: ['package.json'], test: ['src/a.test.ts'] };
    expect(() =>
      reconcileCommitPlan(
        [
          { category: 'feature', message: 'm', files: [] },
          { category: 'test', message: 'm', files: [] },
        ],
        g,
      ),
    ).toThrow(/feature/);
  });

  it('still rejects two names it did not produce', () => {
    expect(() =>
      reconcileCommitPlan(
        [
          { category: 'feature', message: 'm', files: [] },
          { category: 'tests', message: 'm', files: [] },
        ],
        grouped,
      ),
    ).toThrow(/feature|tests/);
  });

  it('rejects a plan that omits a category with staged files', () => {
    expect(() =>
      reconcileCommitPlan([{ category: 'app', message: 'm', files: [] }], grouped),
    ).toThrow(/test/);
  });

  it('rejects a duplicated category', () => {
    expect(() =>
      reconcileCommitPlan(
        [
          { category: 'app', message: 'm1', files: [] },
          { category: 'app', message: 'm2', files: [] },
          { category: 'test', message: 'm', files: [] },
        ],
        grouped,
      ),
    ).toThrow(/app/);
  });

  it("orders the plan code first, then test, then storybook, in the categorizer's order, never the model's", () => {
    // DEFAULT_CATEGORIES order: test and storybook come first so they win the glob match
    const g = {
      test: ['src/a.test.ts'],
      storybook: ['src/A.stories.tsx'],
      config: ['package.json'],
      app: ['src/a.ts'],
      unknown: ['notes/x.md'],
    };
    const steps = Object.keys(g).map((category) => ({ category, message: 'm', files: [] }));
    for (const modelOrder of [steps, [...steps].reverse()]) {
      expect(reconcileCommitPlan(modelOrder, g).map((p) => p.category)).toEqual([
        'config',
        'app',
        'unknown',
        'test',
        'storybook',
      ]);
    }
  });

  it('drops a step for a category that has no staged files', () => {
    const plan = reconcileCommitPlan(
      [
        { category: 'app', message: 'm', files: [] },
        { category: 'test', message: 'm', files: [] },
        { category: 'docs', message: 'docs: nothing', files: [] },
      ],
      grouped,
    );
    expect(plan.map((p) => p.category)).toEqual(['app', 'test']);
  });
});

describe('reconcileCommitPlan with grouping change', () => {
  const g = {
    app: ['src/a.ts', 'src/b.ts'],
    test: ['src/a.test.ts', 'src/b.test.ts'],
    storybook: [],
    unknown: [],
  };
  const shape = (plan: CommitMessage[]) => plan.map((c) => [c.change, c.category, c.files]);

  it('splits a category into one commit per change, ordered by change, code before tests', () => {
    const plan = reconcileCommitPlan(
      [
        { change: 'b', category: 'test', message: 'm1', files: ['src/b.test.ts'] },
        { change: 'a', category: 'app', message: 'm2', files: ['src/a.ts'] },
        { change: 'b', category: 'app', message: 'm3', files: ['src/b.ts'] },
        { change: 'a', category: 'test', message: 'm4', files: ['src/a.test.ts'] },
      ],
      g,
      undefined,
      'change',
    );
    expect(shape(plan)).toEqual([
      ['b', 'app', ['src/b.ts']],
      ['b', 'test', ['src/b.test.ts']],
      ['a', 'app', ['src/a.ts']],
      ['a', 'test', ['src/a.test.ts']],
    ]);
  });

  it("gives a category the model left whole the categorizer's full list", () => {
    const plan = reconcileCommitPlan(
      [
        { change: 'a', category: 'app', message: 'm', files: ['src/a.ts', 'secret.env'] },
        { change: 'a', category: 'test', message: 'm', files: ['src/a.test.ts'] },
        { change: 'b', category: 'test', message: 'm', files: ['src/b.test.ts'] },
      ],
      g,
      undefined,
      'change',
    );
    expect(plan.find((c) => c.category === 'app')?.files).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('treats labels that differ only by surrounding spaces as one change', () => {
    const g2 = { app: ['src/a.ts'], test: ['src/a.test.ts'], other: ['x.md'] };
    const plan = reconcileCommitPlan(
      [
        { change: 'login ', category: 'test', message: 'm', files: [] },
        { change: 'docs', category: 'other', message: 'm', files: [] },
        { change: 'login', category: 'app', message: 'm', files: [] },
      ],
      g2,
      undefined,
      'change',
    );
    expect(shape(plan)).toEqual([
      ['login', 'app', ['src/a.ts']],
      ['login', 'test', ['src/a.test.ts']],
      ['docs', 'other', ['x.md']],
    ]);
  });

  it('refuses a split naming a file that is not staged in that category', () => {
    for (const stray of ['./src/a.ts', 'src/a.test.ts']) {
      expect(() =>
        reconcileCommitPlan(
          [
            { change: 'a', category: 'app', message: 'm', files: [stray] },
            { change: 'b', category: 'app', message: 'm', files: ['src/b.ts'] },
            { change: 'a', category: 'test', message: 'm', files: [] },
          ],
          g,
          undefined,
          'change',
        ),
      ).toThrow(new RegExp(`${stray.replace(/\./g, '\\.')}[\\s\\S]*commitGrouping`));
    }
  });

  it('refuses a split that leaves a staged file out', () => {
    const g3 = { app: ['src/a.ts', 'src/b.ts', 'src/c.ts'], test: [] };
    expect(() =>
      reconcileCommitPlan(
        [
          { change: 'a', category: 'app', message: 'm', files: ['src/a.ts'] },
          { change: 'b', category: 'app', message: 'm', files: ['src/b.ts'] },
        ],
        g3,
        undefined,
        'change',
      ),
    ).toThrow(/src\/c\.ts[\s\S]*commitGrouping/);
  });

  it('refuses a split with an empty entry or a file in two entries', () => {
    const split = (second: string[]) =>
      reconcileCommitPlan(
        [
          { change: 'a', category: 'app', message: 'm', files: ['src/a.ts', 'src/b.ts'] },
          { change: 'b', category: 'app', message: 'm', files: second },
          { change: 'a', category: 'test', message: 'm', files: [] },
        ],
        g,
        undefined,
        'change',
      );
    expect(() => split([])).toThrow(/commitGrouping/);
    expect(() => split(['src/a.ts'])).toThrow(/src\/a\.ts/);
  });

  it('refuses a split entry with no change label, or two entries sharing a label', () => {
    for (const [first, second] of [
      [undefined, 'b'],
      ['  ', 'b'],
      ['a', 'a '],
    ]) {
      expect(() =>
        reconcileCommitPlan(
          [
            { change: first, category: 'app', message: 'm', files: ['src/a.ts'] },
            { change: second, category: 'app', message: 'm', files: ['src/b.ts'] },
            { change: 'a', category: 'test', message: 'm', files: [] },
          ],
          g,
          undefined,
          'change',
        ),
      ).toThrow(/commitGrouping/);
    }
  });

  it('still refuses a split category when grouping is category', () => {
    expect(() =>
      reconcileCommitPlan(
        [
          { change: 'a', category: 'app', message: 'm', files: ['src/a.ts'] },
          { change: 'b', category: 'app', message: 'm', files: ['src/b.ts'] },
          { change: 'a', category: 'test', message: 'm', files: [] },
        ],
        g,
        undefined,
        'category',
      ),
    ).toThrow(/more than once/);
  });

  it('pairs a renamed category once even when the model split it', () => {
    const g2 = { app: ['src/a.ts', 'src/b.ts'], test: [], unknown: [] };
    const renames: Array<[string, string]> = [];
    const plan = reconcileCommitPlan(
      [
        { change: 'a', category: 'feature', message: 'm', files: ['src/a.ts'] },
        { change: 'b', category: 'feature', message: 'm', files: ['src/b.ts'] },
      ],
      g2,
      (from, to) => renames.push([from, to]),
      'change',
    );
    expect(renames).toEqual([['feature', 'app']]);
    expect(shape(plan)).toEqual([
      ['a', 'app', ['src/a.ts']],
      ['b', 'app', ['src/b.ts']],
    ]);
  });

  it("without change labels commits what today's plan commits", () => {
    const steps = [
      { category: 'app', message: 'feat: a', files: ['src/a.ts', 'secret.env'] },
      { category: 'test', message: 'test: a', body: 'why', files: [] },
    ];
    expect(reconcileCommitPlan(steps, grouped, undefined, 'change')).toEqual(
      reconcileCommitPlan(steps, grouped, undefined, 'category'),
    );
  });
});

describe('composeCommitMessage', () => {
  it('joins subject, body and configured trailers', async () => {
    const { composeCommitMessage } = await import('./plan.js');
    const t = 'Co-Authored-By: a <a@x>';
    expect(composeCommitMessage({ category: 'app', message: 'feat: x', files: [] }, [t])).toBe(
      `feat: x\n\n${t}`,
    );
    expect(
      composeCommitMessage({ category: 'app', message: 'feat: x', body: 'why', files: [] }, [t]),
    ).toBe(`feat: x\n\nwhy\n\n${t}`);
    expect(composeCommitMessage({ category: 'app', message: 'feat: x', files: [] }, [])).toBe(
      'feat: x',
    );
  });
});
