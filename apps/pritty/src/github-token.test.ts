import { describe, expect, it } from 'vitest';
import { resolveGitHubToken } from './github-token.js';

/**
 * Order, most explicit first: GH_TOKEN, GITHUB_TOKEN, `gh auth token --user
 * <configured account>`, `gh auth token`, and only then the Copilot
 * device-flow token, whose read:user scope cannot create pull requests.
 */
function deps(o: {
  env?: Record<string, string>;
  account?: string;
  gh?: Record<string, string>; // argv joined → stdout; missing → failure
  copilot?: string;
}) {
  const calls: string[][] = [];
  return {
    calls,
    opts: {
      env: o.env ?? {},
      account: o.account,
      exec: (cmd: string, args: string[]) => {
        calls.push([cmd, ...args]);
        const key = args.join(' ');
        const out = o.gh?.[key];
        return out === undefined ? { status: 1, stdout: '' } : { status: 0, stdout: `${out}\n` };
      },
      readAuth: async () => ({
        version: 1 as const,
        providers: o.copilot ? { 'github-copilot': { apiKey: o.copilot, createdAt: 'x' } } : {},
      }),
    },
  };
}

describe('resolveGitHubToken', () => {
  it('GH_TOKEN wins over everything, then GITHUB_TOKEN', async () => {
    const d = deps({ env: { GH_TOKEN: 'a', GITHUB_TOKEN: 'b' }, copilot: 'c' });
    expect(await resolveGitHubToken(d.opts)).toEqual({ token: 'a', source: 'GH_TOKEN' });
    expect(d.calls).toEqual([]);
    const e = deps({ env: { GITHUB_TOKEN: 'b' }, copilot: 'c' });
    expect(await resolveGitHubToken(e.opts)).toEqual({ token: 'b', source: 'GITHUB_TOKEN' });
  });

  it('asks gh for the configured account before the active one', async () => {
    const d = deps({
      account: 'edwin-skoolscout',
      gh: { 'auth token --user edwin-skoolscout': 'gho_acct', 'auth token': 'gho_active' },
      copilot: 'c',
    });
    expect(await resolveGitHubToken(d.opts)).toEqual({
      token: 'gho_acct',
      source: 'gh auth token --user edwin-skoolscout',
    });
  });

  it('falls back to the active gh login when no account is configured', async () => {
    const d = deps({ gh: { 'auth token': 'gho_active' }, copilot: 'c' });
    expect(await resolveGitHubToken(d.opts)).toEqual({
      token: 'gho_active',
      source: 'gh auth token',
    });
  });

  it('uses the Copilot token only when nothing else exists, and says why that may not work', async () => {
    const d = deps({ copilot: 'ghu_copilot' });
    const r = await resolveGitHubToken(d.opts);
    expect(r).toMatchObject({ token: 'ghu_copilot', source: 'copilot' });
    expect(r?.warning).toMatch(/read:user/);
  });

  it('returns null when there is no token anywhere', async () => {
    expect(await resolveGitHubToken(deps({}).opts)).toBeNull();
  });

  it('refuses an account name that is not a GitHub login', async () => {
    const d = deps({ account: '--hostname evil', gh: { 'auth token': 'gho_active' } });
    await expect(resolveGitHubToken(d.opts)).rejects.toThrow(/github.account/);
    expect(d.calls).toEqual([]);
  });
});
