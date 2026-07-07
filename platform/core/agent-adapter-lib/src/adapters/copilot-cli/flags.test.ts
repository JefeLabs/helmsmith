/**
 * copilot-cli flags tests — argv for the REAL standalone `copilot` print mode.
 *
 * See flags.ts: the adapter targets the standalone GitHub Copilot CLI v1.0.65
 * (`copilot`, not the old `gh copilot` launcher) via
 * `copilot -p "<prompt>" --allow-all-tools --add-dir <workdir> --no-color --silent`.
 */

import { describe, expect, it } from 'vitest';
import type { CopilotCliSpec } from '../../agent.ts';
import { buildCopilotCliArgs, COPILOT_CLI_BINARY, flattenPrompt } from './flags.ts';

const SPEC: CopilotCliSpec = { type: 'copilot-cli', model: 'gpt-4o' };
const WORKDIR = '/work/dir';

describe('copilot-cli flags — argv', () => {
  it('resolves the standalone copilot binary', () => {
    expect(COPILOT_CLI_BINARY).toBe('copilot');
  });

  it('builds the non-interactive print-mode argv with the prompt, workdir and model', () => {
    const args = buildCopilotCliArgs(
      SPEC,
      { messages: [{ role: 'user', content: 'list files' }] },
      WORKDIR,
    );
    expect(args).toEqual([
      '-p',
      'list files',
      '--allow-all-tools',
      '--add-dir',
      WORKDIR,
      '--no-color',
      '--silent',
      '--model',
      'gpt-4o',
    ]);
  });

  it('omits --model when the spec model is empty', () => {
    const args = buildCopilotCliArgs(
      { type: 'copilot-cli', model: '' },
      { messages: [{ role: 'user', content: 'hi' }] },
      WORKDIR,
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
