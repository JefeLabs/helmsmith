/**
 * Tests for copilot-api helpers — getCopilotSessionToken, getCopilotCredential,
 * and callCopilot's 401-retry path.
 *
 * All tests inject a vi.fn() fetch stub so no real network calls are made.
 * AuthStore is backed by a real temp file so setProvider / read round-trips
 * exercise the full cache path.
 */

import { chmod, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthStore } from './auth-store.ts';
import { callCopilot, getCopilotCredential, getCopilotSessionToken } from './copilot-api.ts';

const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';
const COPILOT_CHAT_URL = 'https://api.githubcopilot.com/chat/completions';

let tmpPath: string;
let store: AuthStore;

beforeEach(async () => {
  tmpPath = join(
    tmpdir(),
    `copilot-api-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  const initial = JSON.stringify(
    { version: 1, providers: { 'github-copilot': { apiKey: 'gho_github_token' } } },
    null,
    2,
  );
  await writeFile(tmpPath, initial, { mode: 0o600 });
  await chmod(tmpPath, 0o600);
  store = new AuthStore(tmpPath);
});

afterEach(async () => {
  await rm(tmpPath, { force: true });
});

// ─── getCopilotSessionToken ───────────────────────────────────────────────────

describe('getCopilotSessionToken', () => {
  it('cache-hit: returns stored token without calling fetch when >5min remain', async () => {
    const futureExpiry = Math.floor(Date.now() / 1000) + 10 * 60; // +10 min
    await store.setProvider('github-copilot', {
      apiKey: 'gho_github_token',
      copilotToken: 'ghu_cached_session_token',
      copilotTokenExpiresAt: futureExpiry,
    });

    const mockFetch = vi.fn<typeof fetch>();
    const token = await getCopilotSessionToken(store, 'gho_github_token', mockFetch);

    expect(token).toBe('ghu_cached_session_token');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('cache-miss: calls fetch once at the token URL and stores the result', async () => {
    const newExpiry = Math.floor(Date.now() / 1000) + 30 * 60;
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ token: 'ghu_new_session_token', expires_at: newExpiry }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const token = await getCopilotSessionToken(store, 'gho_github_token', mockFetch);

    expect(token).toBe('ghu_new_session_token');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      COPILOT_TOKEN_URL,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'token gho_github_token' }),
      }),
    );

    // Verify stored in auth store
    const file = await store.read();
    expect(file.providers['github-copilot']?.copilotToken).toBe('ghu_new_session_token');
    expect(file.providers['github-copilot']?.copilotTokenExpiresAt).toBe(newExpiry);
  });

  it('expired token (<5min left): refreshes by calling fetch', async () => {
    const almostExpired = Math.floor(Date.now() / 1000) + 2 * 60; // +2 min (below threshold)
    await store.setProvider('github-copilot', {
      apiKey: 'gho_github_token',
      copilotToken: 'ghu_stale_token',
      copilotTokenExpiresAt: almostExpired,
    });

    const newExpiry = Math.floor(Date.now() / 1000) + 30 * 60;
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ token: 'ghu_refreshed_token', expires_at: newExpiry }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const token = await getCopilotSessionToken(store, 'gho_github_token', mockFetch);

    expect(token).toBe('ghu_refreshed_token');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(COPILOT_TOKEN_URL, expect.anything());
  });

  it('throws when the exchange endpoint returns a non-ok status', async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('Unauthorized', { status: 401 }));

    await expect(getCopilotSessionToken(store, 'gho_bad_token', mockFetch)).rejects.toThrow(
      /Copilot session-token exchange failed \(401\)/,
    );
  });
});

// ─── getCopilotCredential ────────────────────────────────────────────────────

describe('getCopilotCredential', () => {
  it('returns apiKey = exchanged session token and an ISO expiresAt string', async () => {
    const newExpiry = Math.floor(Date.now() / 1000) + 30 * 60;
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ token: 'ghu_session_for_broker', expires_at: newExpiry }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const cred = await getCopilotCredential(store, 'gho_github_token', mockFetch);

    expect(cred.apiKey).toBe('ghu_session_for_broker');
    expect(cred.expiresAt).toBeDefined();
    // Should be a valid ISO string matching the expiry
    const parsed = new Date(cred.expiresAt!);
    expect(parsed.getTime()).toBeCloseTo(newExpiry * 1000, -3);
  });

  it('returns cached session token without a fetch call on cache-hit', async () => {
    const futureExpiry = Math.floor(Date.now() / 1000) + 20 * 60;
    await store.setProvider('github-copilot', {
      apiKey: 'gho_github_token',
      copilotToken: 'ghu_cached_for_broker',
      copilotTokenExpiresAt: futureExpiry,
    });

    const mockFetch = vi.fn<typeof fetch>();
    const cred = await getCopilotCredential(store, 'gho_github_token', mockFetch);

    expect(cred.apiKey).toBe('ghu_cached_for_broker');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── callCopilot 401 retry ───────────────────────────────────────────────────

describe('callCopilot', () => {
  it('401 path: invalidates cached session, re-exchanges, and retries chat — injected fetch called 4 times', async () => {
    const newExpiry = Math.floor(Date.now() / 1000) + 30 * 60;
    const successBody = JSON.stringify({
      choices: [{ message: { content: 'hello' } }],
    });

    // fetch call sequence:
    // [0] COPILOT_TOKEN_URL (first exchange, no cache)
    // [1] COPILOT_CHAT_URL (first chat → 401)
    // [2] COPILOT_TOKEN_URL (re-exchange after invalidation)
    // [3] COPILOT_CHAT_URL (retry chat → 200)
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'ghu_first_session', expires_at: newExpiry }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'ghu_second_session', expires_at: newExpiry }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(successBody, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const result = await callCopilot(store, [{ role: 'user', content: 'hi' }], 'gpt-4o', mockFetch);

    expect(result.choices[0].message.content).toBe('hello');
    expect(mockFetch).toHaveBeenCalledTimes(4);

    // First call: token exchange
    expect(mockFetch).toHaveBeenNthCalledWith(1, COPILOT_TOKEN_URL, expect.anything());
    // Second call: chat (will 401)
    expect(mockFetch).toHaveBeenNthCalledWith(2, COPILOT_CHAT_URL, expect.anything());
    // Third call: re-exchange
    expect(mockFetch).toHaveBeenNthCalledWith(3, COPILOT_TOKEN_URL, expect.anything());
    // Fourth call: retry chat
    expect(mockFetch).toHaveBeenNthCalledWith(4, COPILOT_CHAT_URL, expect.anything());
  });

  it('throws when callCopilot fails with non-401 status', async () => {
    const newExpiry = Math.floor(Date.now() / 1000) + 30 * 60;
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'ghu_session', expires_at: newExpiry }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response('Server error', { status: 503 }));

    await expect(
      callCopilot(store, [{ role: 'user', content: 'hi' }], 'gpt-4o', mockFetch),
    ).rejects.toThrow(/Copilot chat failed \(503\)/);
  });

  it('throws when github-copilot credential is not configured', async () => {
    // Write a store with no github-copilot entry
    const emptyPath = join(tmpdir(), `empty-test-${Date.now()}.json`);
    await writeFile(emptyPath, JSON.stringify({ version: 1, providers: {} }, null, 2), {
      mode: 0o600,
    });
    await chmod(emptyPath, 0o600);
    const emptyStore = new AuthStore(emptyPath);

    const mockFetch = vi.fn<typeof fetch>();
    await expect(
      callCopilot(emptyStore, [{ role: 'user', content: 'hi' }], 'gpt-4o', mockFetch),
    ).rejects.toThrow(/github-copilot not authenticated/);

    await rm(emptyPath, { force: true });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
