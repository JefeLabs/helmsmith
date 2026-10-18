import { describe, expect, it } from 'vitest';
import { ConfigSchema } from '../config.js';
import type { GitOps } from '../git.js';
import { type PrDeps, runPr } from './pr.js';

/**
 * Order of operations is the point: nothing may be pushed or generated before
 * the token is known good and the open-PR check has run. The fakes record
 * every call so the tests can assert on the sequence, not just the outcome.
 */
function fakes(o: {
  openPRs?: { number: number; url: string; title: string; head: string; base: string }[];
  token?: boolean;
  listFails?: boolean;
  remoteDefault?: string;
  config?: Record<string, unknown>;
}): { deps: PrDeps; calls: string[]; createArgs: unknown[] } {
  const calls: string[] = [];
  const createArgs: unknown[] = [];
  const git = {
    getCurrentBranch: async () => 'feature/x',
    getRemoteUrl: async () => 'git@github.com:acme/app.git',
    resolveBaseRef: async (b: string) => b,
    log: async () => {
      calls.push('log');
      return [{ hash: 'a'.repeat(40), subject: 'feat: x' }];
    },
    changedFilesBetween: async () => ['src/x.ts'],
    push: async () => {
      calls.push('push');
    },
  } as unknown as GitOps;
  const deps: PrDeps = {
    git,
    config: ConfigSchema.parse(o.config ?? {}),
    github: {
      assertToken: async () => {
        calls.push('assertToken');
        if (o.token === false) throw new Error('No GitHub token available.');
      },
      getDefaultBranch: async () => {
        calls.push('getDefaultBranch');
        return o.remoteDefault ?? 'main';
      },
      listOpenPRs: async () => {
        calls.push('listOpenPRs');
        if (o.listFails) throw new Error('404');
        return o.openPRs ?? [];
      },
      createPR: async (args) => {
        calls.push('createPR');
        createArgs.push(args);
        return { number: 42, url: 'https://github.com/acme/app/pull/42' };
      },
      addLabels: async () => {
        calls.push('addLabels');
      },
      requestReviewers: async () => {
        calls.push('requestReviewers');
      },
    },
    ai: {
      generatePR: async () => {
        calls.push('generatePR');
        return { title: 'feat: x', body: 'body', labels: [] };
      },
    },
    ticket: async () => ({ ticket: null }),
    template: () => null,
    codeowners: () => null,
    prompts: {
      confirm: async () => true,
      editor: async (d: string) => d,
    },
  };
  return { deps, calls, createArgs };
}

describe('runPr ordering', () => {
  it('returns the existing open PR without generating, pushing or creating', async () => {
    const f = fakes({
      openPRs: [{ number: 7, url: 'u', title: 't', head: 'feature/x', base: 'main' }],
    });
    const result = await runPr({ autoApprove: true }, f.deps);
    expect(result).toEqual({ number: 7, url: 'u', created: false });
    expect(f.calls).not.toContain('generatePR');
    expect(f.calls).not.toContain('push');
    expect(f.calls).not.toContain('createPR');
  });

  it('fails on a missing token before anything is pushed or generated', async () => {
    const f = fakes({ token: false });
    await expect(runPr({ autoApprove: true }, f.deps)).rejects.toThrow(/token/i);
    expect(f.calls).toEqual(['assertToken']);
  });

  it('treats a failed open-PR lookup as fatal rather than pushing anyway', async () => {
    const f = fakes({ listFails: true });
    await expect(runPr({ autoApprove: true }, f.deps)).rejects.toThrow(/404/);
    expect(f.calls).not.toContain('push');
    expect(f.calls).not.toContain('generatePR');
  });

  it('on the happy path checks, then generates, then pushes, then creates', async () => {
    const f = fakes({});
    const result = await runPr({ autoApprove: true }, f.deps);
    expect(result).toEqual({
      number: 42,
      url: 'https://github.com/acme/app/pull/42',
      created: true,
    });
    const order = f.calls.filter((c) =>
      ['assertToken', 'listOpenPRs', 'generatePR', 'push', 'createPR'].includes(c),
    );
    expect(order).toEqual(['assertToken', 'listOpenPRs', 'generatePR', 'push', 'createPR']);
  });

  it('uses the configured base branch without asking GitHub for the default', async () => {
    const f = fakes({ config: { baseBranch: 'develop' }, remoteDefault: 'main' });
    await runPr({ autoApprove: true }, f.deps);
    expect(f.calls).not.toContain('getDefaultBranch');
    expect(f.createArgs[0]).toMatchObject({ base: 'develop', head: 'feature/x' });
  });

  it('does not push or create under --dry-run', async () => {
    const f = fakes({});
    const result = await runPr({ dryRun: true }, f.deps);
    expect(result).toBeUndefined();
    expect(f.calls).not.toContain('push');
    expect(f.calls).not.toContain('createPR');
  });
});
