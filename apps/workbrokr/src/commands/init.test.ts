import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadManifest } from '@helmsmith/workkit';
import { makeRepo } from '@helmsmith/workkit/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';

describe('work init', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('writes a loadable manifest, installs hooks, claims ranges, refuses to overwrite without --force', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const home = join(f.main, '.home');
    const out = runInit({
      repoRoot: f.main,
      home,
      project: 'demo',
      baseBranch: 'develop',
      services: ['frontend=3000', 'backend=8443', 'postgres=5432'],
      storybookHost: 'app-ui',
      hooks: true,
      force: false,
    });
    expect(existsSync(out.manifestPath)).toBe(true);
    const m = await loadManifest(f.main);
    expect(m.ports.services.backend.base).toBe(8443);
    expect(m.ports.services.storybook.base).toBe(6100);
    expect(m.services.backend.start).toMatch(/make/);
    expect(m.services.postgres.health).toMatch(/pg_isready/);
    expect(m.storybook?.hostRoot).toBe('app-ui');
    expect(readFileSync(join(f.main, '.helmsmith/hooks/pre-push'), 'utf8')).toMatch(
      /workbrokr hook pre-push/,
    );
    expect(() =>
      runInit({
        repoRoot: f.main,
        home,
        project: 'demo',
        baseBranch: 'develop',
        services: ['frontend=3000'],
        hooks: false,
        force: false,
      }),
    ).toThrow(/exists/);
  });

  it('rejects a malformed service flag', () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    expect(() =>
      runInit({
        repoRoot: f.main,
        home: join(f.main, '.home'),
        project: 'demo',
        baseBranch: 'develop',
        services: ['frontend'],
        hooks: false,
        force: false,
      }),
    ).toThrow(/name=port/);
  });
});
