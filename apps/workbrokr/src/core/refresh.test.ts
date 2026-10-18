import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runRefresh, selectRefresh } from './refresh.js';

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
});
