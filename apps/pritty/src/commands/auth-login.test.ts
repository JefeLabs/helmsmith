import { describe, expect, it } from 'vitest';
import { runAuthLogin } from './auth-login.js';

function harness() {
  const out: string[] = [];
  const err: string[] = [];
  const deps = {
    login: async (o: {
      onPrompt: (info: { verificationUri: string; userCode: string; expiresIn: number }) => void;
    }) => {
      o.onPrompt({
        verificationUri: 'https://github.com/login/device',
        userCode: 'ABCD-1234',
        expiresIn: 900,
      });
      return { provider: 'github-copilot', apiKey: 'secret', scope: 'read:user' };
    },
    authPath: () => '/home/u/.pritty/auth.json',
    io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) },
  };
  return { out, err, deps };
}

describe('runAuthLogin --json', () => {
  it('prints { provider, scope, path } as the only stdout line; the device-flow prompt goes to stderr', async () => {
    const h = harness();
    await runAuthLogin({ json: true }, h.deps);
    expect(h.out).toHaveLength(1);
    expect(JSON.parse(h.out[0]!)).toEqual({
      provider: 'github-copilot',
      scope: 'read:user',
      path: '/home/u/.pritty/auth.json',
    });
    const stderr = h.err.join('\n');
    expect(stderr).toContain('https://github.com/login/device');
    expect(stderr).toContain('ABCD-1234');
    expect(h.out[0]).not.toContain('secret');
  });

  it('reports scope: null when the flow returns none', async () => {
    const h = harness();
    h.deps.login = async () => ({ provider: 'github-copilot', apiKey: 'secret', scope: undefined });
    await runAuthLogin({ json: true }, h.deps);
    expect(JSON.parse(h.out[0]!)).toMatchObject({ scope: null });
  });

  it('without --json prints the prompt and result on stdout', async () => {
    const h = harness();
    await runAuthLogin({}, h.deps);
    expect(h.err).toEqual([]);
    expect(h.out.join('\n')).toContain('ABCD-1234');
    expect(h.out.join('\n')).toContain('Logged in');
  });
});
