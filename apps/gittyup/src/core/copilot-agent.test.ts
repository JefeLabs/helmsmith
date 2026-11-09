/**
 * The agent a headless (`--json`) merge/pick uses: availability is decided once per
 * run, and a failed call throws so it can be reported as `agent_error` rather than
 * read as "no agent". Network is stubbed; the token lookup is real against a
 * throwaway HELMSMITH_HOME.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COPILOT_CHAT_URL, COPILOT_TOKEN_URL } from '../auth/types.js';
import type { ConflictFile } from '../config/schema.js';
import { checkAgentAvailable, createCopilotAgent } from './copilot-agent.js';

const KEYS = ['HELMSMITH_HOME', 'GITHUB_TOKEN', 'COPILOT_GITHUB_TOKEN'];
let home: string;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'gittyup-agent-'));
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
  process.env.HELMSMITH_HOME = join(home, '.helmsmith');
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(home, { recursive: true, force: true });
});

/** Route the two Copilot endpoints; record the chat request bodies. */
function stubCopilot(opts: { tokenStatus?: number; chatStatus?: number; content?: string } = {}) {
  const chatBodies: Array<{ model: string }> = [];
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (String(url) === COPILOT_TOKEN_URL) {
      const status = opts.tokenStatus ?? 200;
      return status === 200
        ? new Response(
            JSON.stringify({ token: 'cop', expires_at: Math.floor(Date.now() / 1000) + 3600 }),
            { status },
          )
        : new Response('denied', { status });
    }
    if (String(url) === COPILOT_CHAT_URL) {
      chatBodies.push(JSON.parse(String(init?.body)));
      const status = opts.chatStatus ?? 200;
      return status === 200
        ? new Response(
            JSON.stringify({
              choices: [{ message: { content: opts.content ?? 'merged' }, finish_reason: 'stop' }],
            }),
            { status },
          )
        : new Response('boom', { status });
    }
    throw new Error(`unexpected fetch ${String(url)}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, chatBodies };
}

const file: ConflictFile = {
  path: 'f.txt',
  markedContent: '<<<<<<< ours\nA\n=======\nB\n>>>>>>> theirs\n',
  ours: 'A\n',
  theirs: 'B\n',
};

describe('checkAgentAvailable', () => {
  it('is unavailable without a token, and never touches the network', async () => {
    const { fetchMock } = stubCopilot();

    const result = await checkAgentAvailable();

    expect(result).toEqual({ available: false, reason: expect.stringContaining('auth login') });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is available when the token exchanges for a Copilot token', async () => {
    process.env.GITHUB_TOKEN = 't';
    stubCopilot();

    expect(await checkAgentAvailable()).toEqual({ available: true });
  });

  it('is unavailable, with the status, when the exchange is refused', async () => {
    process.env.GITHUB_TOKEN = 't';
    stubCopilot({ tokenStatus: 401 });

    expect(await checkAgentAvailable()).toEqual({
      available: false,
      reason: expect.stringContaining('401'),
    });
  });
});

describe('createCopilotAgent', () => {
  it('returns the model’s reply for the file, asking the configured model', async () => {
    process.env.GITHUB_TOKEN = 't';
    const { chatBodies } = stubCopilot({ content: 'a\nRESOLVED\nc\n' });

    const reply = await createCopilotAgent('m')(file);

    expect(reply).toBe('a\nRESOLVED\nc\n');
    expect(chatBodies[0]?.model).toBe('m');
  });

  it('throws when the model call fails, instead of returning nothing', async () => {
    process.env.GITHUB_TOKEN = 't';
    stubCopilot({ chatStatus: 500 });

    await expect(createCopilotAgent('m')(file)).rejects.toThrow(/Copilot API error \(500\)/);
  });

  it('gives up once the time limit passes, instead of hanging the run', async () => {
    process.env.GITHUB_TOKEN = 't';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        if (String(url) === COPILOT_TOKEN_URL) {
          return new Response(
            JSON.stringify({ token: 'cop', expires_at: Math.floor(Date.now() / 1000) + 3600 }),
            { status: 200 },
          );
        }
        // The chat call never answers; only an abort ends it.
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }),
    );

    await expect(createCopilotAgent('m', { timeoutMs: 50 })(file)).rejects.toThrow(
      /timed out after 50 ms/,
    );
  }, 2_000);
});
