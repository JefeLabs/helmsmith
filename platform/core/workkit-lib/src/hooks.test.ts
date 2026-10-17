import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Git } from './git.js';
import { installHooks } from './hooks.js';
import { makeRepo } from './testing/fixture-repo.js';

describe('installHooks', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('writes executable hooks and points core.hooksPath at them', () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const out = installHooks(f.main, { protectedBranches: ['develop', 'stage'] });
    expect(out.files.map((p) => p.split('/').pop())).toEqual(['pre-commit', 'pre-push']);
    for (const p of out.files) {
      expect(existsSync(p)).toBe(true);
      expect(readFileSync(p, 'utf8')).toMatch(/workbrokr hook/);
    }
    expect(new Git(f.main).run(['config', 'core.hooksPath']).trim()).toBe('.helmsmith/hooks');
  });

  it('refuses to write through a symlink planted where a hook belongs', () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    mkdirSync(join(f.main, '.helmsmith/hooks'), { recursive: true });
    symlinkSync(join(f.main, 'README.md'), join(f.main, '.helmsmith/hooks/pre-commit'));
    expect(() => installHooks(f.main, { protectedBranches: ['develop'] })).toThrow(/symlink/);
    expect(readFileSync(join(f.main, 'README.md'), 'utf8')).toBe('hello');
  });

  it('refuses a commit on a protected branch even when workbrokr is not on PATH', () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    installHooks(f.main, { protectedBranches: ['develop'] });
    let error = '';
    try {
      execFileSync('git', ['commit', '--allow-empty', '-m', 'x'], {
        cwd: f.main,
        env: { ...process.env, PATH: '/usr/bin:/bin' },
        stdio: 'pipe',
      });
    } catch (e) {
      error = (e as { stderr?: Buffer }).stderr?.toString() ?? String(e);
    }
    expect(error).toMatch(/develop.*protected/);
    expect(new Git(f.main).run(['log', '--oneline']).trim().split('\n')).toHaveLength(1);
  });
});
