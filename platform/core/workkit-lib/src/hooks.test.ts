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
    const out = installHooks(f.main);
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
    expect(() => installHooks(f.main)).toThrow(/symlink/);
    expect(readFileSync(join(f.main, 'README.md'), 'utf8')).toBe('hello');
  });
});
