/**
 * flags.test.ts — resolved options → opencode run flags (verified vs v1.17.5).
 */

import { describe, expect, it } from 'vitest';
import { buildOpencodeFlags, OPENCODE_BINARY } from './flags.ts';

describe('buildOpencodeFlags', () => {
  it('emits the headless run + json-format transport flags + model', () => {
    expect(buildOpencodeFlags({ model: 'anthropic/claude-opus-4-7' })).toEqual([
      'run',
      '--format',
      'json',
      '--pure',
      '--thinking',
      '--model',
      'anthropic/claude-opus-4-7',
    ]);
  });

  it('omits --thinking only when explicitly disabled', () => {
    expect(buildOpencodeFlags({ model: 'm', thinking: false })).not.toContain('--thinking');
    expect(buildOpencodeFlags({ model: 'm' })).toContain('--thinking');
  });

  it('adds --attach and --dir in attach mode', () => {
    const args = buildOpencodeFlags({
      model: 'openai/gpt-5.4',
      serverUrl: 'http://localhost:4096',
      workdir: '/work/dir',
    });
    expect(args[args.indexOf('--attach') + 1]).toBe('http://localhost:4096');
    expect(args[args.indexOf('--dir') + 1]).toBe('/work/dir');
  });

  it('does not add --dir without --attach', () => {
    const args = buildOpencodeFlags({ model: 'm', workdir: '/work/dir' });
    expect(args).not.toContain('--dir');
    expect(args).not.toContain('--attach');
  });

  it('adds --dangerously-skip-permissions when opted in', () => {
    expect(buildOpencodeFlags({ model: 'm', dangerouslySkipPermissions: true })).toContain(
      '--dangerously-skip-permissions',
    );
    expect(buildOpencodeFlags({ model: 'm' })).not.toContain('--dangerously-skip-permissions');
  });

  it('exposes the binary name', () => {
    expect(OPENCODE_BINARY).toBe('opencode');
  });
});
