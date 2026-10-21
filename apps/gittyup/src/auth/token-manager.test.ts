import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callCopilot, getCopilotToken, writeAuthCredentials } from './token-manager.js';
import { COPILOT_TOKEN_URL } from './types.js';

let home: string;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'gittyup-auth-'));
  for (const k of ['AGENTX_HOME', 'GITHUB_TOKEN', 'COPILOT_GITHUB_TOKEN'])
    saved[k] = process.env[k];
  process.env.AGENTX_HOME = join(home, '.agentx');
  process.env.GITHUB_TOKEN = undefined;
  process.env.COPILOT_GITHUB_TOKEN = undefined;
  delete process.env.GITHUB_TOKEN;
  delete process.env.COPILOT_GITHUB_TOKEN;
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ['AGENTX_HOME', 'GITHUB_TOKEN', 'COPILOT_GITHUB_TOKEN']) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(home, { recursive: true, force: true });
});

const authPath = () => join(process.env.AGENTX_HOME as string, 'gittyup', 'auth.json');
const stubTokenFetch = (chat?: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      if (String(url) === COPILOT_TOKEN_URL) {
        return new Response(
          JSON.stringify({ token: 'cop_abc', expires_at: Math.floor(Date.now() / 1000) + 3600 }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify(chat ?? { choices: [] }), { status: 200 });
    }),
  );

describe('getCopilotToken token persistence (A1/S6)', () => {
  it('does not overwrite the login github_token with an env token, and writes auth.json 0600', async () => {
    await writeAuthCredentials({ github_token: 'LOGIN' });
    stubTokenFetch();
    const tok = await getCopilotToken('ENV_TOKEN', { fromEnv: true });
    expect(tok).toBe('cop_abc');
    const savedFile = JSON.parse(readFileSync(authPath(), 'utf-8'));
    expect(savedFile.github_token).toBe('LOGIN');
    expect(savedFile.github_token).not.toBe('ENV_TOKEN');
    expect(statSync(authPath()).mode & 0o777).toBe(0o600);
  });

  it('caches the copilot token for a login source, keeping the login github_token', async () => {
    await writeAuthCredentials({ github_token: 'LOGIN' });
    stubTokenFetch();
    await getCopilotToken('LOGIN', { fromEnv: false });
    const savedFile = JSON.parse(readFileSync(authPath(), 'utf-8'));
    expect(savedFile.github_token).toBe('LOGIN');
    expect(savedFile.copilot_token).toBe('cop_abc');
  });
});

describe('callCopilot rejects truncated output (A2)', () => {
  it('throws when the completion finish_reason is "length"', async () => {
    process.env.GITHUB_TOKEN = 'ENV_TOKEN';
    stubTokenFetch({ choices: [{ message: { content: 'half a file' }, finish_reason: 'length' }] });
    await expect(callCopilot([{ role: 'user', content: 'x' }], 'gpt-4o')).rejects.toThrow(
      /truncat/i,
    );
  });
});
