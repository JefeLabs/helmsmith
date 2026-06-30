/**
 * GeminiCliSpec → `gemini` CLI flags (Phase D‴).
 *
 * Verified against the REAL `gemini` CLI v0.43.0 (`gemini --help`):
 *   -p, --prompt <prompt>          headless / non-interactive mode (prompt value)
 *   -o, --output-format stream-json  newline-delimited JSON event stream on stdout
 *                                  (choices: text | json | stream-json)
 *   --approval-mode yolo           auto-approve ALL tools (non-interactive);
 *                                  choices: default | auto_edit | yolo | plan
 *   --skip-trust                   trust the current workspace for this session
 *                                  (a fresh sandboxed git dir is otherwise
 *                                  prompted for trust → would block headless)
 *   --allowed-mcp-server-names ""  MCP allowlist; empty → no real server allowed
 *                                  (defense-in-depth with the $HOME sandbox,
 *                                  which already hides ~/.gemini MCP config)
 *   -m, --model <model>            model id (e.g. gemini-2.5-pro)
 *
 * The conversation travels as the `-p` value (gemini has no stdin stream-json
 * input and no --system-prompt flag — the system prompt is folded into the
 * prompt text; see serializePrompt in index.ts). `-p <prompt>` is appended by
 * the adapter AFTER these flags.
 *
 * Built-in tools run autonomously inside the subprocess and are surfaced as
 * tool-call-* / tool-result chunks for observability only (PRD §11); the host
 * cannot inject custom tool definitions, so AgentInput.tools is NOT forwarded.
 */

import type { GeminiCliSpec } from '../../agent.ts';

/** The CLI binary name (resolved via PATH or spec.binaryPath in the adapter). */
export const GEMINI_BINARY = 'gemini';

/** Default tool-approval mode — auto-approve everything for headless runs. */
const DEFAULT_APPROVAL_MODE = 'yolo';

/**
 * Normalize the model id for `-m`. The provider prefix ('google/') used by the
 * generic `provider/model` convention is stripped — the gemini CLI wants the
 * bare model id (e.g. `gemini-2.5-pro`).
 */
export function normalizeGeminiModel(model: string): string {
  return model.startsWith('google/') ? model.slice('google/'.length) : model;
}

/**
 * Build the argv (excluding the binary + the trailing `-p <prompt>`) for a
 * headless `gemini ... -o stream-json` round-trip.
 */
export function buildGeminiFlags(spec: GeminiCliSpec): string[] {
  return [
    '--output-format',
    'stream-json',
    '--approval-mode',
    spec.approvalMode ?? DEFAULT_APPROVAL_MODE,
    '--skip-trust',
    // Empty MCP allowlist — no real server is permitted (defense-in-depth).
    '--allowed-mcp-server-names',
    '',
    '--model',
    normalizeGeminiModel(spec.model),
  ];
}
