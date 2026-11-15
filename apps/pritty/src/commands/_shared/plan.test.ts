import { describe, expect, it } from 'vitest';
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
