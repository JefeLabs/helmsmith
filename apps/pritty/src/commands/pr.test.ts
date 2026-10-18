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
  openPRs?: {
    number: number;
    url: string;
    title: string;
    head: string;
    base: string;
    draft: boolean;
  }[];
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
        return {
          number: 42,
          url: 'https://github.com/acme/app/pull/42',
          draft: Boolean(args.draft),
        };
      },
      updatePR: async () => {
        calls.push('updatePR');
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
      openPRs: [{ number: 7, url: 'u', title: 't', head: 'feature/x', base: 'main', draft: false }],
    });
    const result = await runPr({ autoApprove: true }, f.deps);
    expect(result).toEqual({
      number: 7,
      url: 'u',
      created: false,
      draft: false,
      head: 'feature/x',
      base: 'main',
    });
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
      draft: false,
      head: 'feature/x',
      base: 'main',
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

describe('runPr honours config autoApprove', () => {
  it('asks no questions when the config says autoApprove', async () => {
    const f = fakes({ config: { autoApprove: true } });
    const asked: string[] = [];
    f.deps.prompts = {
      confirm: async (o) => {
        asked.push(o.message);
        return true;
      },
      editor: async (d) => d.default ?? '',
    };
    const result = await runPr({}, f.deps);
    expect(result?.created).toBe(true);
    expect(asked).toEqual([]);
  });
});

describe('runPr --json', () => {
  it('writes exactly one JSON line to stdout and everything else to stderr', async () => {
    const f = fakes({ config: { baseBranch: 'develop' } });
    const out: string[] = [];
    const err: string[] = [];
    f.deps.io = { out: (s) => out.push(s), err: (s) => err.push(s) };
    const result = await runPr({ json: true }, f.deps);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0]!)).toEqual({
      number: 42,
      url: 'https://github.com/acme/app/pull/42',
      created: true,
      draft: false,
      head: 'feature/x',
      base: 'develop',
    });
    expect(err.length).toBeGreaterThan(0);
    expect(result?.created).toBe(true);
  });

  it('implies auto-approve', async () => {
    const f = fakes({ config: { baseBranch: 'develop' } });
    const asked: string[] = [];
    f.deps.io = { out: () => {}, err: () => {} };
    f.deps.prompts = {
      confirm: async (o) => {
        asked.push(o.message);
        return true;
      },
      editor: async (d) => d.default ?? '',
    };
    await runPr({ json: true }, f.deps);
    expect(asked).toEqual([]);
  });

  it("refuses to inherit GitHub's default branch: --json needs --base or a configured baseBranch", async () => {
    const f = fakes({ remoteDefault: 'main' });
    f.deps.io = { out: () => {}, err: () => {} };
    await expect(runPr({ json: true }, f.deps)).rejects.toThrow(/--base/);
    expect(f.calls).not.toContain('push');
  });
});

describe('runPr §18.2: --draft, given title/body, existing-PR update, --no-push', () => {
  it('creates a draft PR when asked and reports draft in the outcome', async () => {
    const f = fakes({ config: { baseBranch: 'main' } });
    const result = await runPr({ autoApprove: true, draft: true }, f.deps);
    expect(f.createArgs[0]).toMatchObject({ draft: true });
    expect(result).toMatchObject({ created: true, draft: true });
  });

  it('uses a given title and body verbatim, never calling the model or the ticket flow', async () => {
    const f = fakes({ config: { baseBranch: 'main' } });
    let ticketCalls = 0;
    f.deps.ticket = async () => {
      ticketCalls++;
      return undefined;
    };
    const result = await runPr(
      { autoApprove: true, title: 'feat: given', body: 'Given body.' },
      f.deps,
    );
    expect(f.calls).not.toContain('generatePR');
    expect(ticketCalls).toBe(0);
    expect(f.createArgs[0]).toMatchObject({ title: 'feat: given', body: 'Given body.' });
    expect(result?.created).toBe(true);
  });

  it('reads the body from --body-file', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'pritty-body-'));
    try {
      writeFileSync(join(dir, 'body.md'), '## Summary\n\nFrom a file.\n');
      const f = fakes({ config: { baseBranch: 'main' } });
      await runPr({ autoApprove: true, title: 't', bodyFile: join(dir, 'body.md') }, f.deps);
      expect(f.createArgs[0]).toMatchObject({ body: '## Summary\n\nFrom a file.\n' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('infers labels from conventional commit types on the no-AI path', async () => {
    const f = fakes({ config: { baseBranch: 'main' } });
    f.deps.git.log = async () => [
      { hash: 'a'.repeat(40), subject: 'feat(x): add' },
      { hash: 'b'.repeat(40), subject: 'fix: broken' },
    ];
    const labelled: unknown[] = [];
    f.deps.github.addLabels = async (_o, _r, _n, labels) => {
      labelled.push([...labels]);
    };
    await runPr({ autoApprove: true, title: 't', body: 'b' }, f.deps);
    expect(labelled).toEqual([['enhancement', 'bug']]);
  });

  it('updates the existing open PR in place when a title or body is given explicitly', async () => {
    const f = fakes({
      config: { baseBranch: 'main' },
      openPRs: [
        { number: 7, url: 'u', title: 'old', head: 'feature/x', base: 'main', draft: false },
      ],
    });
    const updates: unknown[] = [];
    f.deps.github.updatePR = async (_o, _r, n, patch) => {
      updates.push([n, patch]);
    };
    const result = await runPr({ autoApprove: true, title: 'new title', body: 'new body' }, f.deps);
    expect(updates).toEqual([[7, { title: 'new title', body: 'new body' }]]);
    expect(f.calls).not.toContain('createPR');
    expect(result).toMatchObject({ number: 7, created: false });
  });

  it('skips the push under --no-push and still creates the PR', async () => {
    const f = fakes({ config: { baseBranch: 'main' } });
    const result = await runPr({ autoApprove: true, noPush: true }, f.deps);
    expect(f.calls).not.toContain('push');
    expect(f.calls).toContain('createPR');
    expect(result?.created).toBe(true);
  });
});
