import { describe, it, expect } from 'vitest';
import type { TaskNode, StateDefinition } from '../../../src/config/schema.js';
import { STANDARD_PRESET } from '../../../src/config/state-presets.js';
import { executeQAClear, executeQAClearBatch } from '../../../src/commands/qa-clear.js';

const STATES: StateDefinition[] = [...STANDARD_PRESET];

function makeTask(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: '1',
    title: 'Test task',
    description: '',
    type: 'task',
    status: 'todo',
    complexity: 1,
    priority: 'medium',
    requiredSkills: [],
    dependencies: [],
    readiness: 'pending',
    assignee: null,
    outputs: [],
    tags: [],
    qaFeedback: [],
    children: [],
    metadata: {
      source: '',
      autoExpanded: false,
      skillsInferred: false,
      createdAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

describe('executeQAClear', () => {
  it('removes qa-review-needed tag', () => {
    const tasks = [makeTask({ id: 'T-1', tags: ['qa-review-needed'] })];
    const result = executeQAClear(tasks, 'T-1', STATES);

    expect(result.tagRemoved).toBe(true);
    expect(result.task.tags).not.toContain('qa-review-needed');
  });

  it('records a pass feedback entry', () => {
    const tasks = [makeTask({ id: 'T-1', tags: ['qa-review-needed'] })];
    const result = executeQAClear(tasks, 'T-1', STATES);

    expect(result.feedbackEntry.result).toBe('pass');
    expect(result.task.qaFeedback).toHaveLength(1);
    expect(result.task.qaFeedback[0].result).toBe('pass');
  });

  it('uses custom reporter and note', () => {
    const tasks = [makeTask({ id: 'T-1', tags: ['qa-review-needed'] })];
    const result = executeQAClear(tasks, 'T-1', STATES, {
      reporter: 'dev-agent',
      note: 'Reviewed, tests pass after fix',
    });

    expect(result.feedbackEntry.reporter).toBe('dev-agent');
    expect(result.feedbackEntry.description).toBe('Reviewed, tests pass after fix');
  });

  it('reports tagRemoved=false when tag was not present', () => {
    const tasks = [makeTask({ id: 'T-1', tags: [] })];
    const result = executeQAClear(tasks, 'T-1', STATES);

    expect(result.tagRemoved).toBe(false);
    // Still records a pass entry
    expect(result.task.qaFeedback).toHaveLength(1);
  });

  it('throws for non-existent task', () => {
    const tasks = [makeTask({ id: 'T-1' })];
    expect(() => executeQAClear(tasks, 'T-999', STATES)).toThrow('Task "T-999" not found.');
  });

  it('removes qa-failed-source tag if present', () => {
    const tasks = [makeTask({ id: 'T-1', tags: ['qa-failed-source', 'qa-review-needed'] })];
    const result = executeQAClear(tasks, 'T-1', STATES);

    expect(result.task.tags).not.toContain('qa-failed-source');
    expect(result.task.tags).not.toContain('qa-review-needed');
  });

  it('preserves other tags', () => {
    const tasks = [makeTask({ id: 'T-1', tags: ['important', 'qa-review-needed', 'v2'] })];
    const result = executeQAClear(tasks, 'T-1', STATES);

    expect(result.task.tags).toEqual(['important', 'v2']);
  });

  it('defaults reporter to qa-agent', () => {
    const tasks = [makeTask({ id: 'T-1' })];
    const result = executeQAClear(tasks, 'T-1', STATES);

    expect(result.feedbackEntry.reporter).toBe('qa-agent');
  });
});

describe('executeQAClearBatch', () => {
  it('clears multiple tasks atomically', () => {
    const tasks = [
      makeTask({ id: 'T-1', tags: ['qa-review-needed'] }),
      makeTask({ id: 'T-2', tags: ['qa-review-needed'] }),
      makeTask({ id: 'T-3', tags: ['qa-review-needed', 'qa-failed-source'] }),
    ];

    const result = executeQAClearBatch(tasks, [
      { taskId: 'T-1' },
      { taskId: 'T-2', note: 'Tests pass' },
      { taskId: 'T-3', reporter: 'dev-agent' },
    ], STATES);

    expect(result.entries).toHaveLength(3);
    expect(result.errors).toHaveLength(0);

    // All tags removed
    expect(tasks[0].tags).not.toContain('qa-review-needed');
    expect(tasks[1].tags).not.toContain('qa-review-needed');
    expect(tasks[2].tags).not.toContain('qa-review-needed');
    expect(tasks[2].tags).not.toContain('qa-failed-source');

    // All got pass feedback
    expect(tasks[0].qaFeedback).toHaveLength(1);
    expect(tasks[0].qaFeedback[0].result).toBe('pass');
    expect(tasks[1].qaFeedback[0].description).toBe('Tests pass');
    expect(tasks[2].qaFeedback[0].reporter).toBe('dev-agent');
  });

  it('handles mix of valid and invalid task IDs', () => {
    const tasks = [
      makeTask({ id: 'T-1', tags: ['qa-review-needed'] }),
    ];

    const result = executeQAClearBatch(tasks, [
      { taskId: 'T-1' },
      { taskId: 'T-999' },
    ], STATES);

    expect(result.entries).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].taskId).toBe('T-999');
    expect(result.errors[0].error).toContain('not found');
    expect(tasks[0].tags).not.toContain('qa-review-needed');
  });

  it('reports tagRemoved=false when tag was not present', () => {
    const tasks = [
      makeTask({ id: 'T-1', tags: ['qa-review-needed'] }),
      makeTask({ id: 'T-2', tags: [] }),
    ];

    const result = executeQAClearBatch(tasks, [
      { taskId: 'T-1' },
      { taskId: 'T-2' },
    ], STATES);

    expect(result.entries[0].tagRemoved).toBe(true);
    expect(result.entries[1].tagRemoved).toBe(false);
    // Both still get pass feedback
    expect(tasks[1].qaFeedback).toHaveLength(1);
  });

  it('preserves other tags', () => {
    const tasks = [
      makeTask({ id: 'T-1', tags: ['important', 'qa-review-needed', 'v2'] }),
    ];

    const result = executeQAClearBatch(tasks, [{ taskId: 'T-1' }], STATES);

    expect(result.entries[0].tagRemoved).toBe(true);
    expect(tasks[0].tags).toEqual(['important', 'v2']);
  });

  it('defaults reporter to qa-agent and description to standard text', () => {
    const tasks = [makeTask({ id: 'T-1' })];

    const result = executeQAClearBatch(tasks, [{ taskId: 'T-1' }], STATES);

    expect(result.entries[0].feedbackEntry.reporter).toBe('qa-agent');
    expect(result.entries[0].feedbackEntry.description).toBe('QA review cleared');
  });
});
