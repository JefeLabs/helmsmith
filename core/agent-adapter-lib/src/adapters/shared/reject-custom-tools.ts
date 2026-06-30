/**
 * Shared guard for autonomous adapters (PRD §11, §13 D3).
 *
 * The agentic CLIs (claude-code-cli, opencode-cli, copilot-cli, gemini-cli,
 * codex-cli) and the claude-agent-sdk run their OWN built-in tools inside the
 * backend; a host cannot inject custom tool definitions. Passing `input.tools`
 * to one of them would be silently dropped — so we fail fast at the stream/
 * invoke entry instead of misleading the caller into thinking its tools ran.
 *
 * Host-loop adapters (claude-sdk, openai-sdk, gemini-sdk, copilot-sdk,
 * bedrock-sdk) DO accept custom tools and must NOT call this helper.
 */

import type { AgentInput, AgentSpecType } from '../../agent.ts';
import { CapabilityMismatchError } from '../../errors.ts';

/**
 * Throw a CapabilityMismatchError when `input.tools` is non-empty for an
 * autonomous adapter. No-op when no tools are requested.
 */
export function rejectCustomTools(type: AgentSpecType, input: AgentInput): void {
  if (input.tools && input.tools.length > 0) {
    throw new CapabilityMismatchError(
      `Adapter type '${type}' runs its built-in tools autonomously and cannot inject custom ` +
        "tool definitions. Remove the 'tools' array from AgentInput, or use a host-loop adapter " +
        '(e.g. claude-sdk, openai-sdk, gemini-sdk) that surfaces tool calls for the host to run.',
    );
  }
}
