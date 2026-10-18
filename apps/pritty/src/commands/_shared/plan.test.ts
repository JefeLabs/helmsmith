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
