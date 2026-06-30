/**
 * Copilot contract-header tests (PRD §8.4).
 *
 * These five headers are the API contract — a wrong value returns 403 with no
 * useful body, so they are asserted verbatim.
 */

import { describe, expect, it } from 'vitest';
import { buildCopilotHeaders, COPILOT_CHAT_URL, COPILOT_CONTRACT_HEADERS } from './headers.ts';

describe('copilot-sdk headers — §8.4 contract', () => {
  it('hardcodes the Copilot client-identity headers', () => {
    expect(COPILOT_CONTRACT_HEADERS).toMatchObject({
      'User-Agent': 'GithubCopilot/1.155.0',
      'Editor-Plugin-Version': 'copilot.vim/1.16.0',
      'Copilot-Integration-Id': 'vscode-chat',
      'Openai-Intent': 'conversation-panel',
    });
    // Editor-Version is "consumer-supplied" per §8.4 — pinned + non-empty here.
    expect(COPILOT_CONTRACT_HEADERS['Editor-Version']).toMatch(/\S+/);
  });

  it('targets the OpenAI-compatible chat-completions endpoint', () => {
    expect(COPILOT_CHAT_URL).toBe('https://api.githubcopilot.com/chat/completions');
  });

  it('builds the full header set with Bearer auth + SSE Accept by default', () => {
    const headers = buildCopilotHeaders('tok-123');
    expect(headers.Authorization).toBe('Bearer tok-123');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Accept).toBe('text/event-stream');
    // Contract headers are carried through unchanged.
    expect(headers['Copilot-Integration-Id']).toBe('vscode-chat');
    expect(headers['User-Agent']).toBe('GithubCopilot/1.155.0');
  });

  it('honours a custom Accept (e.g. non-streaming JSON)', () => {
    const headers = buildCopilotHeaders('tok', { accept: 'application/json' });
    expect(headers.Accept).toBe('application/json');
  });
});
