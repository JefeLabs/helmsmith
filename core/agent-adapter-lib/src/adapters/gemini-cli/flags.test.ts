/**
 * flags.test.ts — GeminiCliSpec → gemini CLI flags.
 */

import { describe, expect, it } from 'vitest';
import type { GeminiCliSpec } from '../../agent.ts';
import { buildGeminiFlags, GEMINI_BINARY, normalizeGeminiModel } from './flags.ts';

const baseSpec: GeminiCliSpec = { type: 'gemini-cli', model: 'gemini-2.5-pro' };

describe('buildGeminiFlags', () => {
  it('emits the headless stream-json transport flags + approval + MCP suppression + model', () => {
    expect(buildGeminiFlags(baseSpec)).toEqual([
      '--output-format',
      'stream-json',
      '--approval-mode',
      'yolo',
      '--skip-trust',
      '--allowed-mcp-server-names',
      '',
      '--model',
      'gemini-2.5-pro',
    ]);
  });

  it('honors a spec-provided approvalMode', () => {
    const args = buildGeminiFlags({ ...baseSpec, approvalMode: 'plan' });
    expect(args[args.indexOf('--approval-mode') + 1]).toBe('plan');
  });

  it('strips a google/ provider prefix from the model', () => {
    const args = buildGeminiFlags({ ...baseSpec, model: 'google/gemini-2.5-flash' });
    expect(args[args.indexOf('--model') + 1]).toBe('gemini-2.5-flash');
  });

  it('passes an empty MCP allowlist value (no real server permitted)', () => {
    const args = buildGeminiFlags(baseSpec);
    expect(args[args.indexOf('--allowed-mcp-server-names') + 1]).toBe('');
  });

  it('exposes the binary name', () => {
    expect(GEMINI_BINARY).toBe('gemini');
  });
});

describe('normalizeGeminiModel', () => {
  it('strips google/ prefix; leaves bare ids untouched', () => {
    expect(normalizeGeminiModel('google/gemini-2.5-pro')).toBe('gemini-2.5-pro');
    expect(normalizeGeminiModel('gemini-2.5-pro')).toBe('gemini-2.5-pro');
  });
});
