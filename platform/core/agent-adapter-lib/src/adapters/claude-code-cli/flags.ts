/**
 * AgentSpec → `claude` CLI flags (Phase C).
 *
 * Verified against the REAL `claude` CLI v2.1.195 (`claude --help`):
 *   --print                       headless / non-interactive (print and exit)
 *   --output-format stream-json   newline-delimited JSON event stream on stdout
 *   --input-format  stream-json   newline-delimited JSON messages on stdin
 *   --verbose                     full event stream (kept for forward-compat;
 *                                 v2.1.195 streams JSON without it, but older
 *                                 builds require it with --print + stream-json)
 *   --model <model>               model alias or full name
 *   --system-prompt <prompt>      REPLACES the default system prompt
 *
 * Built-in tools run autonomously inside the subprocess; the host cannot inject
 * custom tool definitions (PRD §11 — observability-only), so AgentInput.tools is
 * NOT forwarded as flags. A `tools` array is rejected earlier by the adapter's
 * capability guard only if the matrix ever flips supportsToolUse to false.
 */

import type { AgentInput, ClaudeCodeCliSpec } from '../../agent.ts';

/** The CLI binary name (resolved via PATH or spec.binaryPath in the adapter). */
export const CLAUDE_BINARY = 'claude';

/**
 * Build the argv for a headless `claude` stream-json round-trip.
 *
 * The conversation itself travels over stdin as stream-json (see
 * serializeStdin in index.ts); these flags configure the transport, model,
 * and (optional) system prompt. AgentInput.systemPrompt overrides
 * spec.systemPrompt when both are present.
 */
export function buildClaudeFlags(spec: ClaudeCodeCliSpec, input: AgentInput): string[] {
  const args: string[] = [
    '--print',
    '--output-format',
    'stream-json',
    '--input-format',
    'stream-json',
    '--verbose',
    '--model',
    spec.model,
  ];

  const systemPrompt = input.systemPrompt ?? spec.systemPrompt;
  if (systemPrompt !== undefined && systemPrompt.length > 0) {
    args.push('--system-prompt', systemPrompt);
  }

  return args;
}
