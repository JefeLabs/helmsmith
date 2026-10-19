import { describe, expect, it } from 'vitest';
import type { ConflictFile } from '../config/schema.js';
import { buildAiMessages, diffStat, extractLastFencedBlock, stripOuterFence } from './ai-text.js';

describe('stripOuterFence', () => {
  it('removes a bare fence', () => {
    expect(stripOuterFence('```\na\nb\n```')).toBe('a\nb\n');
  });

  it('removes a fence with a language tag', () => {
    expect(stripOuterFence('```ts\nconst a = 1;\n```\n')).toBe('const a = 1;\n');
  });

  it('leaves unfenced text alone', () => {
    expect(stripOuterFence('a\nb\n')).toBe('a\nb\n');
  });

  it('does not strip an inner fence', () => {
    const t = 'intro\n```\ncode\n```\n';
    expect(stripOuterFence(t)).toBe(t);
  });
});

describe('extractLastFencedBlock', () => {
  it('returns the block and the text before it', () => {
    expect(extractLastFencedBlock('Reasoning here.\n\n```\nmerged\n```')).toEqual({
      rationale: 'Reasoning here.',
      code: 'merged\n',
    });
  });

  it('takes the last of two blocks', () => {
    expect(extractLastFencedBlock('```\nfirst\n```\nthen\n```js\nsecond\n```')?.code).toBe(
      'second\n',
    );
  });

  it('returns null when there is no block', () => {
    expect(extractLastFencedBlock('just prose')).toBeNull();
  });
});

describe('diffStat', () => {
  it('counts added and removed lines', () => {
    expect(diffStat('a\nb\nc\n', 'a\nB\nc\nd\n')).toEqual({ added: 2, removed: 1 });
  });
});

describe('buildAiMessages', () => {
  const file: ConflictFile = {
    path: 'f.txt',
    markedContent: 'm',
    ours: 'o\n',
    theirs: 't\n',
    base: 'b\n',
    hunks: [],
  };

  it('sends the complete files and the marked copy', () => {
    const [sys, user] = buildAiMessages(file, 'auto');
    expect(sys.role).toBe('system');
    expect(sys.content).toContain('Output the complete merged file and nothing else');
    expect(user.content).toContain('=== OURS (complete file) ===\no\n');
    expect(user.content).toContain('=== BASE (complete file) ===\nb\n');
    expect(user.content).toContain('=== CONFLICTED WORKING COPY ===\nm');
  });

  it('omits BASE when absent and marks a deleted side', () => {
    const [, user] = buildAiMessages({ ...file, base: undefined, theirs: undefined }, 'suggest');
    expect(user.content).not.toContain('=== BASE');
    expect(user.content).toContain('=== THEIRS (complete file) ===\n(deleted on this side)');
  });

  it('asks suggest mode for a final fenced block', () => {
    expect(buildAiMessages(file, 'suggest')[0].content).toContain(
      'The code block must be the last thing in your reply.',
    );
  });
});
