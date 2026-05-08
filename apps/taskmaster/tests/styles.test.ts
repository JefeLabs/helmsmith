import { describe, it, expect } from 'vitest';
import { PROJECT_STYLES, STYLE_NAMES, getStyle, getValidTypes } from '../src/config/styles.js';

describe('project styles', () => {
  it('defines 4 styles', () => {
    expect(STYLE_NAMES).toHaveLength(4);
    expect(STYLE_NAMES).toContain('agile-full');
    expect(STYLE_NAMES).toContain('story-driven');
    expect(STYLE_NAMES).toContain('task-only');
    expect(STYLE_NAMES).toContain('flat');
  });

  it('agile-full has max depth 4', () => {
    const style = getStyle('agile-full');
    expect(style).toBeDefined();
    expect(style!.maxDepth).toBe(4);
    expect(style!.hierarchy).toEqual(['epic', 'story', 'task', 'subtask']);
  });

  it('story-driven has max depth 3', () => {
    const style = getStyle('story-driven');
    expect(style!.maxDepth).toBe(3);
    expect(style!.hierarchy).toEqual(['story', 'task', 'subtask']);
  });

  it('task-only has max depth 2', () => {
    const style = getStyle('task-only');
    expect(style!.maxDepth).toBe(2);
    expect(style!.hierarchy).toEqual(['task', 'subtask']);
  });

  it('flat has max depth 1', () => {
    const style = getStyle('flat');
    expect(style!.maxDepth).toBe(1);
    expect(style!.hierarchy).toEqual(['task']);
  });

  it('getValidTypes returns hierarchy for known style', () => {
    expect(getValidTypes('agile-full')).toEqual(['epic', 'story', 'task', 'subtask']);
  });

  it('getValidTypes returns [task] for unknown style', () => {
    expect(getValidTypes('unknown')).toEqual(['task']);
  });
});
