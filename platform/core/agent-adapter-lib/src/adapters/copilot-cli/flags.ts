/**
 * AgentSpec → standalone `copilot` argv (Phase D′; consolidated-fix rework).
 *
 * Verified against the REAL standalone GitHub Copilot CLI v1.0.65 (`copilot`,
 * /opt/homebrew/bin/copilot — NOT the old `gh copilot` launcher). Probes:
 *   $ copilot --version  → "GitHub Copilot CLI 1.0.65."
 *   $ copilot --help     → -p/--prompt non-interactive mode, --allow-all-tools,
 *                          --add-dir, --no-color, --silent, --model, …
 *
 * The adapter targets the documented NON-INTERACTIVE PRINT MODE:
 *
 *   copilot -p "<prompt>" --allow-all-tools --add-dir <workdir> --no-color \
 *           --silent [--model <model>]
 *
 * Real flags (`copilot --help`):
 *   -p, --prompt <text>  "Execute a prompt in non-interactive mode (exits after
 *                        completion)" — single-shot; the basis for the one
 *                        synthetic text-delta the adapter emits.
 *   --allow-all-tools    "Allow all tools to run automatically without
 *                        confirmation; required for non-interactive mode." The
 *                        standalone `copilot` is an AUTONOMOUS agent (edits
 *                        files, runs shell, searches the codebase). Blast radius
 *                        is bounded by the adapter's $HOME/$TMPDIR + cwd sandbox
 *                        (see index.ts), same pattern as opencode's
 *                        --dangerously-skip-permissions.
 *   --add-dir <dir>      "Add a directory to the allowed list for file access" —
 *                        the workdir, so the agent can read/write the work tree.
 *   --no-color           strip ANSI so the captured stdout is clean text.
 *   --silent             "Output only the agent response (no stats), useful for
 *                        scripting with -p" — keeps the buffered stdout to just
 *                        the answer.
 *   --model <model>      select the model (passed verbatim; omitted when unset).
 *
 * Auth is via env (COPILOT_GITHUB_TOKEN → GH_TOKEN → GITHUB_TOKEN); see index.ts.
 */

import type { AgentInput, ChatMessage, CopilotCliSpec } from '../../agent.ts';

/** The standalone Copilot CLI binary (resolved via PATH or spec.binaryPath). */
export const COPILOT_CLI_BINARY = 'copilot';

/**
 * Build the argv (excluding the binary) for a single-shot, non-interactive
 * `copilot` print-mode round-trip. The prompt is flattened from the
 * conversation (see flattenPrompt) and passed via `-p`; `--add-dir` scopes file
 * access to the workdir.
 */
export function buildCopilotCliArgs(
  spec: CopilotCliSpec,
  input: AgentInput,
  workdir: string,
): string[] {
  const prompt = flattenPrompt(input, spec);
  const args: string[] = [
    '-p',
    prompt,
    '--allow-all-tools', // required for non-interactive mode
    '--add-dir',
    workdir,
    '--no-color',
    '--silent', // only the agent response (no stats footer)
  ];

  if (spec.model && spec.model.length > 0) {
    args.push('--model', spec.model);
  }

  return args;
}

/**
 * Flatten the conversation into a single prompt string. `copilot -p` takes one
 * prompt argument (no stdin/stream-json transport), so the optional system
 * prompt and each message's text are joined with blank lines — single-shot,
 * consistent with the opencode-cli serializer.
 */
export function flattenPrompt(input: AgentInput, spec: CopilotCliSpec): string {
  const system = input.systemPrompt ?? spec.systemPrompt;
  const parts: string[] = [];
  if (system && system.length > 0) parts.push(system);
  for (const m of input.messages) parts.push(textOf(m.content));
  return parts.filter((p) => p.length > 0).join('\n\n');
}

function textOf(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .map((block) => {
      switch (block.type) {
        case 'text':
          return block.text;
        case 'thinking':
          return block.thinking;
        case 'tool-use':
          return `[tool-use ${block.name}: ${JSON.stringify(block.input)}]`;
        case 'tool-result':
          return `[tool-result ${block.toolCallId}: ${block.output}]`;
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n');
}
