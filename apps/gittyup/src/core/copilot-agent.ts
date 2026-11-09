/**
 * The agent behind headless (`--json`) merge/pick conflict resolution (spec §5.3).
 *
 * Text mode's `Orchestrator.createAiResolver` returns `null` both when there is no token
 * and when Copilot fails, and prints about it. A JSON report has to tell those apart
 * (`agent_unavailable` vs `agent_error`), so here availability is checked once per run
 * and a failed call throws.
 */
import { callCopilot, getCopilotToken, resolveGitHubToken } from '../auth/token-manager.js';
import { CLI_BIN_NAME } from '../config/branding.js';
import type { ConflictFile } from '../config/schema.js';
import { buildAiMessages } from './ai-text.js';

/** Ask the agent for the complete merged file. Resolves with its raw text ('' when the
 *  reply is empty); throws on any network or model error. */
export type AgentReply = (file: ConflictFile) => Promise<string>;

export type AgentAvailability = { available: true } | { available: false; reason: string };

/**
 * Whether the agent can be reached: a token from the agent's own lookup (env or
 * `auth login`, never `gh`/git credentials) that Copilot accepts.
 */
export async function checkAgentAvailable(): Promise<AgentAvailability> {
  const source = await resolveGitHubToken();
  if (!source) {
    return {
      available: false,
      reason: `no GitHub token for the agent (set GITHUB_TOKEN or run "${CLI_BIN_NAME} auth login")`,
    };
  }
  try {
    await getCopilotToken(source.token, { fromEnv: source.source !== 'auth.json' });
    return { available: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { available: false, reason: `Copilot token exchange failed: ${message}` };
  }
}

/** Upper bound on one file's agent call. A hung call would otherwise hang the run, and a
 *  caller that kills gittyup then can't get the repo rolled back. */
export const AGENT_TIMEOUT_MS = 120_000;

export function createCopilotAgent(model: string, opts: { timeoutMs?: number } = {}): AgentReply {
  const timeoutMs = opts.timeoutMs ?? AGENT_TIMEOUT_MS;
  return async (file) => {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const response = await callCopilot(buildAiMessages(file, 'auto'), model, { signal });
      return response.choices?.[0]?.message?.content ?? '';
    } catch (err) {
      if (signal.aborted) throw new Error(`agent timed out after ${timeoutMs} ms`);
      throw err;
    }
  };
}
