/**
 * AgentSpec → `gh copilot` argv (Phase D′).
 *
 * ⚠️ PRD/plan DEVIATION — verified against the REAL installed tooling:
 *   gh 2.95.0 + `gh copilot` extension v1.2.0 (github/gh-copilot).
 *
 * The PRD §8.5 / Phase-D′ plan assumed `gh copilot suggest --target=shell|git|gh`
 * (a single-turn SHELL-SUGGESTION CLI). That interface NO LONGER EXISTS. In
 * v1.2.0 the `gh copilot` extension is a thin LAUNCHER that downloads and runs
 * the new agentic **GitHub Copilot CLI** (`copilot`, v1.0.65 here). Probes:
 *   $ gh copilot --version          → "GitHub Copilot CLI 1.0.65."
 *   $ gh copilot suggest -t shell …  → "error: unknown option '-t'"  (suggest gone)
 *   $ gh copilot -- --help           → agentic CLI help (-p/--prompt, --model, …)
 *
 * Per the plan's explicit mandate ("Follow the REAL `gh copilot` over PRD
 * assumptions"), this adapter targets the REAL agentic CLI in its documented
 * NON-INTERACTIVE PRINT MODE:
 *
 *   gh copilot -- -p "<prompt>" --allow-all-tools --no-color --log-level none \
 *               [--model <model>]
 *
 * Notes on the real flags (`gh copilot -- --help`):
 *   --                  separator so `gh` passes the remaining flags through to
 *                       the agentic `copilot` binary instead of interpreting them.
 *   -p, --prompt <text> "Execute a prompt in non-interactive mode" (single-shot,
 *                       prints the answer and exits — the basis for the one
 *                       synthetic text-delta the adapter emits).
 *   --allow-all-tools   "required for non-interactive mode" (otherwise the agent
 *                       blocks awaiting tool-permission confirmation with no TTY).
 *                       Blast radius is bounded by the adapter's $HOME/$TMPDIR +
 *                       cwd sandbox (see index.ts), same pattern as opencode's
 *                       --dangerously-skip-permissions.
 *   --no-color          strip ANSI so the captured stdout is clean text.
 *   --log-level none    keep progress/log noise off stdout.
 *   --model <model>     select the model (passed verbatim; omitted when unset).
 *
 * The legacy `spec.subcommand` ('shell'|'git'|'gh') maps to the removed
 * `--target` and has NO equivalent in the agentic CLI; it is accepted for
 * back-compat but currently ignored (see the report's auth/shape gap notes).
 */

import type { AgentInput, ChatMessage, CopilotCliSpec } from '../../agent.ts';

/** The launcher binary (resolved via PATH or spec.binaryPath in the adapter). */
export const COPILOT_CLI_BINARY = 'gh';

/**
 * Build the argv (excluding the binary) for a single-shot, non-interactive
 * `gh copilot` print-mode round-trip. The prompt is flattened from the
 * conversation (see flattenPrompt) and passed via `-p`.
 */
export function buildCopilotCliArgs(spec: CopilotCliSpec, input: AgentInput): string[] {
  const prompt = flattenPrompt(input, spec);
  const args: string[] = [
    'copilot',
    '--', // pass the rest through to the agentic copilot binary
    '-p',
    prompt,
    '--allow-all-tools', // required for non-interactive mode
    '--no-color',
    '--log-level',
    'none',
  ];

  if (spec.model && spec.model.length > 0) {
    args.push('--model', spec.model);
  }

  return args;
}

/**
 * Flatten the conversation into a single prompt string. `gh copilot -p` takes
 * one prompt argument (no stdin/stream-json transport), so the optional system
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
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n');
}
