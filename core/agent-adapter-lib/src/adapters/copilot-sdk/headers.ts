/**
 * Copilot Chat API contract headers (PRD §8.4 — hardcoded, NOT parameterizable).
 *
 * GitHub Copilot's chat-completions endpoint rejects requests (403, no useful
 * body) when these client-identity headers are wrong. They mirror what the
 * VS Code Copilot extension sends. Getting any one wrong = silent 403, so the
 * adapter logs all of them at DEBUG on every call (see index.ts).
 *
 * `Editor-Version` is nominally "consumer-supplied" in the PRD; we pin a
 * default here so the contract is self-contained and the value is auditable.
 *
 * Endpoint constant lives here too so it is the single source of truth.
 */

/** GitHub Copilot OpenAI-compatible chat-completions endpoint. */
export const COPILOT_CHAT_URL = 'https://api.githubcopilot.com/chat/completions';

/**
 * The five Copilot client-identity headers (PRD §8.4). Sent verbatim on every
 * request alongside `Authorization: Bearer <copilot-session-token>` and
 * `Content-Type: application/json`.
 */
export const COPILOT_CONTRACT_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'User-Agent': 'GithubCopilot/1.155.0',
  // PRD §8.4 lists this as "<consumer-supplied user agent>"; pinned for a
  // self-contained, auditable contract.
  'Editor-Version': 'vscode/1.155.0',
  'Editor-Plugin-Version': 'copilot.vim/1.16.0',
  'Copilot-Integration-Id': 'vscode-chat',
  'Openai-Intent': 'conversation-panel',
});

/**
 * Build the full header set for a Copilot chat request: the contract headers
 * plus auth + content negotiation. `accept` defaults to SSE (streaming).
 */
export function buildCopilotHeaders(
  token: string,
  opts?: { accept?: string },
): Record<string, string> {
  return {
    ...COPILOT_CONTRACT_HEADERS,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: opts?.accept ?? 'text/event-stream',
  };
}
