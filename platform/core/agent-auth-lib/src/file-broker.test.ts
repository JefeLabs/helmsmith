/**
 * Tests for FileBroker.getCredential.
 *
 * Key invariants:
 *   - github-copilot: returns the EXCHANGED Copilot session token (not the raw
 *     GitHub OAuth apiKey) — proven by asserting the returned apiKey differs
 *     from the raw github key in auth.json.
 *   - Other providers (e.g. anthropic): returns the raw apiKey, no fetch call.
 *   - Unknown providers throw.
 *   - REPLACE_ME placeholder throws.
 *   - Bad file permissions (not 0600) throw.
 */

import { chmod, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileBroker } from './file-broker.ts';

const RAW_GITHUB_TOKEN = 'gho_raw_github_oauth_token';
const EXCHANGED_SESSION_TOKEN = 'ghu_exchanged_copilot_session_token';

let tmpPath: string;

function makeCopilotTokenFetch(sessionToken = EXCHANGED_SESSION_TOKEN): typeof fetch {
  const expiry = Math.floor(Date.now() / 1000) + 30 * 60;
  return vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify({ token: sessionToken, expires_at: expiry }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

async function writeAuthFile(path: string, providers: Record<string, unknown>): Promise<void> {
  const content = JSON.stringify({ version: 1, providers }, null, 2);
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600);
}

beforeEach(async () => {
  tmpPath = join(
    tmpdir(),
    `file-broker-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
});

afterEach(async () => {
  await rm(tmpPath, { force: true });
});

// ─── github-copilot: returns the exchanged session token ──────────────────────

describe('FileBroker.getCredential — github-copilot', () => {
  it('returns the EXCHANGED session token (not the raw github apiKey)', async () => {
    await writeAuthFile(tmpPath, {
      'github-copilot': { apiKey: RAW_GITHUB_TOKEN },
    });
    const mockFetch = makeCopilotTokenFetch();
    const broker = new FileBroker(tmpPath, { fetchFn: mockFetch });

    const cred = await broker.getCredential('github-copilot');

    // The apiKey must be the exchanged session token, NOT the raw github key
    expect(cred.apiKey).toBe(EXCHANGED_SESSION_TOKEN);
    expect(cred.apiKey).not.toBe(RAW_GITHUB_TOKEN);
    expect(cred.provider).toBe('github-copilot');
    expect(cred.source).toBe('host-file');
    expect(cred.tokenType).toBe('copilot-session');
    expect(cred.expiresAt).toBeDefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns cached session token from store without a fetch call on cache-hit', async () => {
    const futureExpiry = Math.floor(Date.now() / 1000) + 20 * 60;
    await writeAuthFile(tmpPath, {
      'github-copilot': {
        apiKey: RAW_GITHUB_TOKEN,
        copilotToken: 'ghu_already_cached',
        copilotTokenExpiresAt: futureExpiry,
      },
    });
    const mockFetch = vi.fn<typeof fetch>();
    const broker = new FileBroker(tmpPath, { fetchFn: mockFetch });

    const cred = await broker.getCredential('github-copilot');

    expect(cred.apiKey).toBe('ghu_already_cached');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws when apiKey is still the REPLACE_ME placeholder', async () => {
    await writeAuthFile(tmpPath, {
      'github-copilot': { apiKey: 'REPLACE_ME' },
    });
    const mockFetch = vi.fn<typeof fetch>();
    const broker = new FileBroker(tmpPath, { fetchFn: mockFetch });

    await expect(broker.getCredential('github-copilot')).rejects.toThrow(/placeholder credential/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── non-copilot providers: raw apiKey, no fetch ──────────────────────────────

describe('FileBroker.getCredential — non-copilot providers', () => {
  it('anthropic: returns raw apiKey without any fetch call', async () => {
    await writeAuthFile(tmpPath, {
      anthropic: { apiKey: 'sk-ant-real-key' },
    });
    const mockFetch = vi.fn<typeof fetch>();
    const broker = new FileBroker(tmpPath, { fetchFn: mockFetch });

    const cred = await broker.getCredential('anthropic');

    expect(cred.apiKey).toBe('sk-ant-real-key');
    expect(cred.provider).toBe('anthropic');
    expect(cred.source).toBe('host-file');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('openai: returns raw apiKey without any fetch call', async () => {
    await writeAuthFile(tmpPath, {
      openai: { apiKey: 'sk-proj-openai-key', tokenType: 'Bearer' },
    });
    const mockFetch = vi.fn<typeof fetch>();
    const broker = new FileBroker(tmpPath, { fetchFn: mockFetch });

    const cred = await broker.getCredential('openai');

    expect(cred.apiKey).toBe('sk-proj-openai-key');
    expect(cred.tokenType).toBe('Bearer');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── back-compat: existing new FileBroker(path) call still works ──────────────

describe('FileBroker — backward compatibility', () => {
  it('new FileBroker(path) without options still works for non-copilot provider', async () => {
    await writeAuthFile(tmpPath, {
      anthropic: { apiKey: 'sk-ant-compat-test' },
    });
    // No second argument — back-compat
    const broker = new FileBroker(tmpPath);

    const cred = await broker.getCredential('anthropic');
    expect(cred.apiKey).toBe('sk-ant-compat-test');
  });
});

// ─── error cases ──────────────────────────────────────────────────────────────

describe('FileBroker.getCredential — error cases', () => {
  it('throws when the provider is not in the file', async () => {
    await writeAuthFile(tmpPath, { anthropic: { apiKey: 'sk-ant-key' } });
    const broker = new FileBroker(tmpPath);

    await expect(broker.getCredential('openai')).rejects.toThrow(/Provider not configured/);
  });

  it('throws when file permissions are not 0600', async () => {
    await writeAuthFile(tmpPath, { anthropic: { apiKey: 'sk-ant-key' } });
    await chmod(tmpPath, 0o644);

    const broker = new FileBroker(tmpPath);
    await expect(broker.getCredential('anthropic')).rejects.toThrow(/required 0600/);
  });
});
