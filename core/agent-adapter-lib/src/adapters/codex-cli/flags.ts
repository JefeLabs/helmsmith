/**
 * CodexCliSpec → `codex exec` CLI flags (Phase D‴).
 *
 * Verified against the REAL `codex` CLI v0.133.0 (`codex exec --help`):
 *   exec                           non-interactive subcommand; prompt is the
 *                                  trailing positional [PROMPT] (also reads
 *                                  stdin — the adapter closes stdin to avoid a
 *                                  "Reading additional input from stdin..." hang).
 *   --json                         print events to stdout as JSONL (the modern
 *                                  thread-event stream: thread.started /
 *                                  turn.started / item.completed / turn.completed
 *                                  / turn.failed / error). Verified live.
 *   --sandbox <mode>               sandbox policy for model-run shell commands;
 *                                  choices read-only | workspace-write |
 *                                  danger-full-access. Default 'workspace-write'
 *                                  (writes confined to the workspace + temp,
 *                                  network off) — the SAFE non-interactive
 *                                  choice (NOT --dangerously-bypass-...).
 *   --skip-git-repo-check          do not refuse to run outside a git repo
 *                                  (workdir is always a repo; belt-and-suspenders).
 *   --ignore-user-config           do NOT load $CODEX_HOME/config.toml — this
 *                                  cleanly suppresses any user MCP servers (auth
 *                                  still works via the injected OPENAI_API_KEY).
 *   --color never                  no ANSI on stderr.
 *   --model <model>                model id (e.g. gpt-5-codex).
 *
 * The prompt positional is appended by the adapter AFTER these flags
 * (`codex exec [OPTIONS] <PROMPT>`).
 *
 * Built-in tools (command_execution/file_change/mcp_tool_call/web_search) run
 * autonomously inside the subprocess and are surfaced as tool-call-* /
 * tool-result chunks for observability only (PRD §11); the host cannot inject
 * custom tool definitions, so AgentInput.tools is NOT forwarded.
 */

import type { CodexCliSpec } from '../../agent.ts';

/** The CLI binary name (resolved via PATH or spec.binaryPath in the adapter). */
export const CODEX_BINARY = 'codex';

/** Default sandbox policy — writes confined to the workspace; network off. */
const DEFAULT_SANDBOX_MODE = 'workspace-write';

/**
 * Normalize the model id for `--model`. The provider prefix ('openai/') used by
 * the generic `provider/model` convention is stripped — codex wants the bare
 * model id (e.g. `gpt-5-codex`).
 */
export function normalizeCodexModel(model: string): string {
  return model.startsWith('openai/') ? model.slice('openai/'.length) : model;
}

/**
 * Build the argv (excluding the binary + the trailing prompt positional) for a
 * headless `codex exec --json` round-trip.
 */
export function buildCodexFlags(spec: CodexCliSpec): string[] {
  return [
    'exec',
    '--json',
    '--sandbox',
    spec.sandboxMode ?? DEFAULT_SANDBOX_MODE,
    '--skip-git-repo-check',
    '--ignore-user-config',
    '--color',
    'never',
    '--model',
    normalizeCodexModel(spec.model),
  ];
}
