/**
 * flags.test.ts — CodexCliSpec → codex exec CLI flags.
 */

import { describe, expect, it } from 'vitest';
import type { CodexCliSpec } from '../../agent.ts';
import { buildCodexFlags, CODEX_BINARY, normalizeCodexModel } from './flags.ts';

const baseSpec: CodexCliSpec = { type: 'codex-cli', model: 'gpt-5-codex' };

describe('buildCodexFlags', () => {
  it('emits the exec --json transport flags + safe sandbox + MCP suppression + model', () => {
    expect(buildCodexFlags(baseSpec)).toEqual([
      'exec',
      '--json',
      '--sandbox',
      'workspace-write',
      '--skip-git-repo-check',
      '--ignore-user-config',
      '--color',
      'never',
      '--model',
      'gpt-5-codex',
    ]);
  });

  it('honors a spec-provided sandboxMode', () => {
    const args = buildCodexFlags({ ...baseSpec, sandboxMode: 'read-only' });
    expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only');
  });

  it('strips an openai/ provider prefix from the model', () => {
    const args = buildCodexFlags({ ...baseSpec, model: 'openai/o4-mini' });
    expect(args[args.indexOf('--model') + 1]).toBe('o4-mini');
  });

  it('starts with the non-interactive exec subcommand', () => {
    expect(buildCodexFlags(baseSpec)[0]).toBe('exec');
  });

  it('exposes the binary name', () => {
    expect(CODEX_BINARY).toBe('codex');
  });
});

describe('normalizeCodexModel', () => {
  it('strips openai/ prefix; leaves bare ids untouched', () => {
    expect(normalizeCodexModel('openai/gpt-5-codex')).toBe('gpt-5-codex');
    expect(normalizeCodexModel('gpt-5-codex')).toBe('gpt-5-codex');
  });
});
