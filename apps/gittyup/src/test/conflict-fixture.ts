/**
 * A repo shaped for merge/pick conflict tests (headless merge/pick, PR 2):
 *
 *   main:    base (f.txt = a/b/c) ── mainF (f.txt = a/MAIN/c)
 *   feature: base ── addA (a.txt) ── changeF (f.txt = a/FEATURE/c) ── addB (b.txt)
 *                 ── changeF2 (f.txt = a/FEATURE2/c)
 *   side:    base ── addG (g.txt)
 *
 * Merging feature → main conflicts on f.txt; merging side → main is clean.
 * Picking changeF onto main conflicts; once changeF is resolved to anything
 * but FEATURE, picking changeF2 conflicts again. Left checked out on main.
 */
import { type FixtureRepo, makeRepo } from './git-fixture.js';

export interface ConflictRepo extends FixtureRepo {
  /** Full SHAs of the named commits. */
  c: { addA: string; changeF: string; addB: string; changeF2: string; addG: string };
}

export async function makeConflictRepo(): Promise<ConflictRepo> {
  const repo = await makeRepo({
    commits: [
      { message: 'base', files: { 'f.txt': 'a\nb\nc\n' } },
      { branch: 'feature', from: 'main', message: 'feat: add a', files: { 'a.txt': 'A\n' } },
      {
        branch: 'feature',
        message: 'feat: b becomes FEATURE',
        files: { 'f.txt': 'a\nFEATURE\nc\n' },
      },
      { branch: 'feature', message: 'feat: add b', files: { 'b.txt': 'B\n' } },
      {
        branch: 'feature',
        message: 'feat: b becomes FEATURE2',
        files: { 'f.txt': 'a\nFEATURE2\nc\n' },
      },
      { branch: 'side', from: 'main', message: 'side: add g', files: { 'g.txt': 'G\n' } },
      { branch: 'main', message: 'main: b becomes MAIN', files: { 'f.txt': 'a\nMAIN\nc\n' } },
    ],
  });
  return Object.assign(repo, {
    c: {
      addA: await repo.sha('feature~3'),
      changeF: await repo.sha('feature~2'),
      addB: await repo.sha('feature~1'),
      changeF2: await repo.sha('feature'),
      addG: await repo.sha('side'),
    },
  });
}
