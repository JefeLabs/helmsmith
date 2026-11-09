/**
 * `gittyup connect` must report the token gittyup will actually use, which
 * comes from requireGitHubToken's cascade: env → auth.json (`auth login`) →
 * `gh auth token` → git credential. These run the real cascade against a
 * throwaway home; PATH points at an empty directory so the gh and git steps
 * find nothing unless a test says otherwise.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { githubConnection } from './github-connection.js';
import { writeAuthCredentials } from './token-manager.js';

const KEYS = ['HELMSMITH_HOME', 'GITHUB_TOKEN', 'GH_TOKEN', 'COPILOT_GITHUB_TOKEN', 'PATH'];
let home: string;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'gittyup-connect-'));
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
  process.env.HELMSMITH_HOME = join(home, '.helmsmith');
  process.env.PATH = join(home, 'empty-bin');
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(home, { recursive: true, force: true });
});

describe('githubConnection.getStatus', () => {
  it('is connected when the only token is the one `gittyup auth login` saved', async () => {
    await writeAuthCredentials({ github_token: 'gho_SAVEDLOGIN1234' });

    const status = await githubConnection.getStatus();

    expect(status.state).toBe('connected');
  });

  it('is disconnected, with a hint, when no step of the cascade finds a token', async () => {
    const status = await githubConnection.getStatus();

    expect(status.state).toBe('disconnected');
    expect(status.message).toContain('gittyup auth login');
  });

  it('never shows the whole token', async () => {
    process.env.GITHUB_TOKEN = 'ghp_SECRETSECRETSECRET9876';

    const status = await githubConnection.getStatus();

    expect(status.state).toBe('connected');
    expect(JSON.stringify(status)).not.toContain('SECRETSECRETSECRET');
  });
});
