import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { emitWorktreeConfig, renderTemplate } from './config.js';
import { Git } from './git.js';
import { validateManifest } from './manifest.js';
import { makeRepo } from './testing/fixture-repo.js';
import { minimal } from './testing/manifests.js';

describe('config', () => {
  it('renders known variables and refuses unknown ones', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: manifest placeholder syntax
    expect(renderTemplate('p=${PORT_BACKEND}', { PORT_BACKEND: '8444' })).toBe('p=8444');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: manifest placeholder syntax
    expect(() => renderTemplate('${NOPE}', {})).toThrow(/NOPE/);
  });

  it('writes .slot, the env file and the log dir for a fullstack effort', () => {
    const wt = mkdtempSync(join(tmpdir(), 'wk-cfg-'));
    const out = emitWorktreeConfig({
      m: validateManifest(minimal),
      worktree: wt,
      slot: 3,
      ports: { frontend: 3003, backend: 8446 },
      area: 'shop/cart',
      branch: 'feature/shop/cart',
    });
    expect(readFileSync(join(wt, '.slot'), 'utf8')).toBe('3\n');
    expect(readFileSync(out.envFile, 'utf8')).toContain('PORT_BACKEND=8446');
    expect(readFileSync(out.envFile, 'utf8')).toContain('SLOT=3');
    expect(out.logDir).toBe(join(wt, '.logs'));
    expect(existsSync(out.logDir)).toBe(true);
    expect(out.vars.AREA).toBe('shop/cart');
    expect(out.vars.STORYBROKR_HOST).toBe(wt);
    expect(readFileSync(out.envFile, 'utf8')).toContain(`STORYBROKR_HOST=${wt}`);
  });

  it('writes no .slot, an empty SLOT, and resolves STORYBROKR_HOST with storybook.hostRoot when configured', () => {
    const wt = mkdtempSync(join(tmpdir(), 'wk-cfg-'));
    const out = emitWorktreeConfig({
      m: validateManifest({ ...minimal, storybook: { hostRoot: 'app-ui' } }),
      worktree: wt,
      ports: {},
      storybookPort: 6103,
      area: 'shop/cart',
      branch: 'feature/shop/cart',
    });
    expect(existsSync(join(wt, '.slot'))).toBe(false);
    expect(readFileSync(out.envFile, 'utf8')).toContain('SLOT=\n');
    expect(out.vars.PORT_STORYBOOK).toBe('6103');
    expect(out.vars.STORYBROKR_HOST).toBe(join(wt, 'app-ui'));
    expect(readFileSync(out.envFile, 'utf8')).toContain(`STORYBROKR_HOST=${join(wt, 'app-ui')}`);
  });

  it('keeps the emitted files out of git status through the repo-wide exclude file', () => {
    const f = makeRepo();
    try {
      const g = new Git(f.main);
      const wt = join(f.main, '.claude/worktrees/shop/cart');
      g.worktreeAdd(wt, 'feature/shop/cart', 'origin/develop');
      emitWorktreeConfig({
        m: validateManifest(minimal),
        worktree: wt,
        slot: 2,
        ports: { frontend: 3002, backend: 8445 },
        area: 'shop/cart',
        branch: 'feature/shop/cart',
      });
      expect(new Git(wt).isDirty()).toBe(false);
      expect(g.isDirty()).toBe(false);
    } finally {
      f.cleanup();
    }
  });
});

describe('W7: PORT_STORYBOOK with a storybook port service in the manifest', () => {
  it('keeps the storybrokr instance port when one is given, else falls back to the slot-derived port', async () => {
    const { validateManifest } = await import('./manifest.js');
    const { minimal } = await import('./testing/manifests.js');
    const { slotVars } = await import('./config.js');
    const m = validateManifest({
      ...minimal,
      ports: {
        services: {
          frontend: { base: 43000 },
          backend: { base: 43100 },
          storybook: { base: 6100 },
        },
      },
    });
    const withInstance = slotVars(m, {
      slot: 3,
      ports: { frontend: 43003, backend: 43103, storybook: 6103 },
      storybookPort: 6150,
    });
    expect(withInstance.PORT_STORYBOOK).toBe('6150');
    const slotOnly = slotVars(m, {
      slot: 3,
      ports: { frontend: 43003, backend: 43103, storybook: 6103 },
    });
    expect(slotOnly.PORT_STORYBOOK).toBe('6103');
    const frontendNoSlot = slotVars(m, { ports: {}, storybookPort: 6150 });
    expect(frontendNoSlot.PORT_STORYBOOK).toBe('6150');
  });
});
