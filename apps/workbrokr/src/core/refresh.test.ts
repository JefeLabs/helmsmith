import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Git } from './git.js';
import { runRefresh, selectRefresh } from './refresh.js';
import { commitFile, makeRepo } from './testing/fixture-repo.js';

describe('refresh', () => {
  const entries = [
    { when: 'app-ui/package-lock.json', run: 'install-ui' },
    { when: 'db/**', mark: 'db-reset' },
    { always: true, run: 'clear-cache' },
  ];
  it('selects by changed paths and always-entries', () => {
    expect(selectRefresh(entries, ['db/V1.sql'])).toEqual({
      runs: ['clear-cache'],
      marks: ['db-reset'],
    });
    expect(selectRefresh(entries, ['app-ui/package-lock.json'])).toEqual({
      runs: ['install-ui', 'clear-cache'],
      marks: [],
    });
    expect(selectRefresh(entries, [])).toEqual({ runs: ['clear-cache'], marks: [] });
  });
  it('runs commands in the worktree and names the one that fails', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wk-ref-'));
    const log: string[] = [];
    runRefresh(['touch refreshed.marker'], cwd, (l) => log.push(l));
    expect(existsSync(join(cwd, 'refreshed.marker'))).toBe(true);
    expect(() => runRefresh(['exit 3'], cwd, () => {})).toThrow(/exit 3/);
  });
  it('triggers when-entries on cold worktree via content hash stamp, skips when unchanged, and restores dirtied clean lockfiles', () => {
    const f = makeRepo();
    try {
      commitFile(f.main, 'app-ui/package-lock.json', '{"v":1}', 'add lockfile');
      const stampFile = join(f.main, '.logs/.refresh-stamps.json');
      const e = [
        {
          when: 'app-ui/package-lock.json',
          run: 'echo "{\\"v\\":1,\\"dirty\\":true}" > app-ui/package-lock.json && mkdir -p .logs && touch .logs/installed.marker',
        },
      ];
      const sel1 = selectRefresh(e, [], { worktree: f.main, stampFile });
      expect(sel1.runs).toHaveLength(1);
      runRefresh(sel1.runs, f.main, () => {}, process.env, {
        stampFile,
        pendingStamps: sel1.pendingStamps,
        restoreFiles: sel1.cleanWhenFiles,
      });
      expect(existsSync(join(f.main, '.logs/installed.marker'))).toBe(true);
      expect(
        new Git(f.main).run(['status', '--porcelain', '--', 'app-ui/package-lock.json']).trim(),
      ).toBe('');
      const sel2 = selectRefresh(e, [], { worktree: f.main, stampFile });
      expect(sel2.runs).toEqual([]);
      commitFile(f.main, 'app-ui/package-lock.json', '{"v":2}', 'bump lockfile');
      const sel3 = selectRefresh(e, [], { worktree: f.main, stampFile });
      expect(sel3.runs).toHaveLength(1);
    } finally {
      f.cleanup();
    }
  });
});
