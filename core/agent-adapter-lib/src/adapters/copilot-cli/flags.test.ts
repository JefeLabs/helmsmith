/**
 * copilot-cli flags tests — argv for the REAL agentic `gh copilot` print mode.
 *
 * See flags.ts: v1.2.0 `gh copilot` is the agentic CLI launcher (no
 * `suggest`/`--target`); the adapter uses `gh copilot -- -p "<prompt>"
 * --allow-all-tools …`.
 */

import { describe, expect, it } from 'vitest';
import type { CopilotCliSpec } from '../../agent.ts';
import { buildCopilotCliArgs, COPILOT_CLI_BINARY, flattenPrompt } from './flags.ts';

const SPEC: CopilotCliSpec = { type: 'copilot-cli', model: 'gpt-4o' };

describe('copilot-cli flags — argv', () => {
  it('resolves the gh launcher binary', () => {
    expect(COPILOT_CLI_BINARY).toBe('gh');
  });

  it('builds the non-interactive print-mode argv with the prompt and model', () => {
    const args = buildCopilotCliArgs(SPEC, { messages: [{ role: 'user', content: 'list files' }] });
    expect(args).toEqual([
      'copilot',
      '--',
      '-p',
      'list files',
      '--allow-all-tools',
      '--no-color',
      '--log-level',
      'none',
      '--model',
      'gpt-4o',
    ]);
  });

  it('omits --model when the spec model is empty', () => {
    const args = buildCopilotCliArgs(
      { type: 'copilot-cli', model: '' },
      { messages: [{ role: 'user', content: 'hi' }] },
    );
    expect(args).not.toContain('--model');
  });
});

describe('copilot-cli flags — flattenPrompt', () => {
  it('joins the system prompt and message texts with blank lines', () => {
    const prompt = flattenPrompt(
      {
        ...({} as object),
        messages: [{ role: 'user', content: 'do X' }],
        systemPrompt: 'be terse',
      },
      SPEC,
    );
    expect(prompt).toBe('be terse\n\ndo X');
  });

  it('input.systemPrompt overrides spec.systemPrompt', () => {
    const prompt = flattenPrompt(
      { messages: [{ role: 'user', content: 'q' }], systemPrompt: 'from-input' },
      { type: 'copilot-cli', model: 'm', systemPrompt: 'from-spec' },
    );
    expect(prompt).toBe('from-input\n\nq');
  });

  it('flattens content blocks', () => {
    const prompt = flattenPrompt(
      {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'hello' },
              { type: 'thinking', thinking: 'hmm' },
            ],
          },
        ],
      },
      SPEC,
    );
    expect(prompt).toBe('hello\nhmm');
  });
});
