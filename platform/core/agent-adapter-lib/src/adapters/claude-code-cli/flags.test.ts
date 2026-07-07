/**
 * flags.test.ts — AgentSpec → claude CLI flags.
 */

import { describe, expect, it } from 'vitest';
import type { AgentInput, ClaudeCodeCliSpec } from '../../agent.ts';
import { buildClaudeFlags, CLAUDE_BINARY } from './flags.ts';

const baseSpec: ClaudeCodeCliSpec = { type: 'claude-code-cli', model: 'claude-sonnet-4-6' };
const emptyInput: AgentInput = { messages: [{ role: 'user', content: 'hi' }] };

describe('buildClaudeFlags', () => {
  it('emits the headless stream-json transport flags + model', () => {
    const args = buildClaudeFlags(baseSpec, emptyInput);
    expect(args).toEqual([
      '--print',
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      '--verbose',
      '--model',
      'claude-sonnet-4-6',
    ]);
  });

  it('appends --system-prompt from the spec', () => {
    const args = buildClaudeFlags({ ...baseSpec, systemPrompt: 'You are a reviewer.' }, emptyInput);
    expect(args).toContain('--system-prompt');
    expect(args[args.indexOf('--system-prompt') + 1]).toBe('You are a reviewer.');
  });

  it('input.systemPrompt overrides spec.systemPrompt', () => {
    const args = buildClaudeFlags(
      { ...baseSpec, systemPrompt: 'spec persona' },
      { ...emptyInput, systemPrompt: 'input persona' },
    );
    expect(args[args.indexOf('--system-prompt') + 1]).toBe('input persona');
  });

  it('omits --system-prompt when neither spec nor input set one', () => {
    expect(buildClaudeFlags(baseSpec, emptyInput)).not.toContain('--system-prompt');
  });

  it('exposes the binary name', () => {
    expect(CLAUDE_BINARY).toBe('claude');
  });
});
