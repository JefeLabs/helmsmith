import { describe, expect, it } from 'vitest';
import { executeQAFail, executeQAFailBatch } from '../../../src/commands/qa-fail.js';
import type { StateDefinition, TaskNode } from '../../../src/config/schema.js';
import { STANDARD_PRESET } from '../../../src/config/state-presets.js';

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

describe('executeQAFail', () => {
  it('sets task status to qa-failed and records feedback', () => {
    const tasks = [makeTask({ id: 'T-1', status: 'done' })];
    const result = executeQAFail(tasks, 'T-1', STATES, false, {
      testType: 'component',
      description: 'Config loader fails on empty YAML',
      cause: 'Missing null check',
      severity: 'major',
    });

    expect(result.task.status).toBe('qa-failed');
    expect(result.oldStatus).toBe('done');
    expect(result.feedbackEntry.result).toBe('fail');
    expect(result.feedbackEntry.testType).toBe('component');
    expect(result.feedbackEntry.description).toBe('Config loader fails on empty YAML');
    expect(result.feedbackEntry.cause).toBe('Missing null check');
    expect(result.task.qaFeedback).toHaveLength(1);
  });

  it('adds qa-failed-source tag to the task', () => {
    const tasks = [makeTask({ id: 'T-1', status: 'done' })];
    const result = executeQAFail(tasks, 'T-1', STATES, false, {
      testType: 'unit',
      description: 'Test fails',
    });

    expect(result.task.tags).toContain('qa-failed-source');
  });

  it('throws for non-existent task', () => {
    const tasks = [makeTask({ id: 'T-1' })];
    expect(() =>
      executeQAFail(tasks, 'T-999', STATES, false, {
        testType: 'unit',
        description: 'Test fails',
      }),
    ).toThrow('Task "T-999" not found.');
  });

  it('tags direct dependents with qa-review-needed', () => {
    const tasks = [
      makeTask({ id: 'T-1', status: 'done' }),
      makeTask({
        id: 'T-2',
        status: 'todo',
        dependencies: [{ taskId: 'T-1', type: 'blocks' }],
      }),
      makeTask({ id: 'T-3', status: 'todo' }), // no dependency on T-1
    ];
    const result = executeQAFail(tasks, 'T-1', STATES, false, {
      testType: 'component',
      description: 'fails',
    });

    expect(result.taggedDependents).toEqual(['T-2']);
    expect(tasks[1].tags).toContain('qa-review-needed');
    expect(tasks[2].tags).not.toContain('qa-review-needed');
  });

  it('pulls back done dependents to review', () => {
    const tasks = [
      makeTask({ id: 'T-1', status: 'done' }),
      makeTask({
        id: 'T-2',
        status: 'done',
        dependencies: [{ taskId: 'T-1', type: 'blocks' }],
      }),
    ];
    const result = executeQAFail(tasks, 'T-1', STATES, false, {
      testType: 'integration',
      description: 'API contract broken',
    });

    expect(result.pulledBackDependents).toEqual(['T-2']);
    expect(tasks[1].status).toBe('review'); // pulled back from done
    expect(tasks[1].tags).toContain('qa-review-needed');
  });

  it('is idempotent - appends another entry when already qa-failed', () => {
    const tasks = [
      makeTask({
        id: 'T-1',
        status: 'qa-failed',
        qaFeedback: [
          {
            testType: 'unit',
            result: 'fail',
            description: 'First failure',
            cause: '',
            severity: 'major',
            reporter: 'qa-agent',
            timestamp: '2026-01-01T00:00:00Z',
          },
        ],
      }),
    ];

    const result = executeQAFail(tasks, 'T-1', STATES, false, {
      testType: 'integration',
      description: 'Second failure',
      severity: 'critical',
    });

    expect(result.task.status).toBe('qa-failed');
    expect(result.task.qaFeedback).toHaveLength(2);
    expect(result.task.qaFeedback[1].description).toBe('Second failure');
    expect(result.task.qaFeedback[1].severity).toBe('critical');
  });

  it('only tags direct dependents, not transitive', () => {
    const tasks = [
      makeTask({ id: 'T-1', status: 'done' }),
      makeTask({
        id: 'T-2',
        status: 'done',
        dependencies: [{ taskId: 'T-1', type: 'blocks' }],
      }),
      makeTask({
        id: 'T-3',
        status: 'todo',
        dependencies: [{ taskId: 'T-2', type: 'blocks' }],
      }),
    ];
    const result = executeQAFail(tasks, 'T-1', STATES, false, {
      testType: 'unit',
      description: 'fails',
    });

    expect(result.taggedDependents).toEqual(['T-2']);
    expect(tasks[1].tags).toContain('qa-review-needed');
    // T-3 should NOT be directly tagged (only T-2)
    expect(tasks[2].tags).not.toContain('qa-review-needed');
  });

  it('ignores relates dependencies when finding dependents', () => {
    const tasks = [
      makeTask({ id: 'T-1', status: 'done' }),
      makeTask({
        id: 'T-2',
        status: 'todo',
        dependencies: [{ taskId: 'T-1', type: 'relates' }],
      }),
    ];
    const result = executeQAFail(tasks, 'T-1', STATES, false, {
      testType: 'unit',
      description: 'fails',
    });

    expect(result.taggedDependents).toEqual([]);
  });

  it('respects enforce_transitions and rejects invalid transition', () => {
    // 'todo' -> 'qa-failed' is not in the transitions list for todo
    const tasks = [makeTask({ id: 'T-1', status: 'todo' })];
    expect(() =>
      executeQAFail(tasks, 'T-1', STATES, true, {
        testType: 'unit',
        description: 'fails',
      }),
    ).toThrow('Cannot transition from "todo" to "qa-failed"');
  });

  it('--force bypasses transition restrictions', () => {
    const tasks = [makeTask({ id: 'T-1', status: 'todo' })];
    const result = executeQAFail(tasks, 'T-1', STATES, true, {
      testType: 'unit',
      description: 'fails',
      force: true,
    });

    expect(result.task.status).toBe('qa-failed');
  });

  it('cascades qa-failed to children when --cascade is set', () => {
    const tasks = [
      makeTask({
        id: 'T-1',
        status: 'done',
        children: [
          makeTask({ id: 'T-1.1', status: 'done' }),
          makeTask({ id: 'T-1.2', status: 'in-progress' }),
        ],
      }),
    ];
    const result = executeQAFail(tasks, 'T-1', STATES, false, {
      testType: 'e2e',
      description: 'whole module fails',
      cascade: true,
    });

    expect(result.task.children[0].status).toBe('qa-failed');
    expect(result.task.children[1].status).toBe('qa-failed');
    expect(result.task.children[0].tags).toContain('qa-failed-source');
  });

  it('defaults severity to major and reporter to qa-agent', () => {
    const tasks = [makeTask({ id: 'T-1', status: 'done' })];
    const result = executeQAFail(tasks, 'T-1', STATES, false, {
      testType: 'manual',
      description: 'Visual defect',
    });

    expect(result.feedbackEntry.severity).toBe('major');
    expect(result.feedbackEntry.reporter).toBe('qa-agent');
  });

  it('recomputes readiness after qa-fail (dependents auto-block)', () => {
    const tasks = [
      makeTask({ id: 'T-1', status: 'done' }),
      makeTask({
        id: 'T-2',
        status: 'todo',
        readiness: 'ready',
        dependencies: [{ taskId: 'T-1', type: 'blocks' }],
      }),
    ];
    executeQAFail(tasks, 'T-1', STATES, false, {
      testType: 'unit',
      description: 'fails',
    });

    // T-2 should now be blocked because T-1 is no longer closed
    expect(tasks[1].readiness).toBe('blocked');
  });
});

describe('executeQAFailBatch', () => {
  it('processes multiple failures atomically', () => {
    const tasks = [
      makeTask({ id: 'T-1', status: 'done' }),
      makeTask({ id: 'T-2', status: 'done' }),
      makeTask({ id: 'T-3', status: 'done' }),
    ];

    const result = executeQAFailBatch(
      tasks,
      [
        { taskId: 'T-1', testType: 'unit', description: 'Test A fails' },
        {
          taskId: 'T-2',
          testType: 'integration',
          description: 'Test B fails',
          severity: 'critical',
        },
        { taskId: 'T-3', testType: 'e2e', description: 'Test C fails', severity: 'minor' },
      ],
      STATES,
      false,
    );

    expect(result.entries).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
    expect(tasks[0].status).toBe('qa-failed');
    expect(tasks[1].status).toBe('qa-failed');
    expect(tasks[2].status).toBe('qa-failed');
    expect(result.summary.failed).toBe(3);
    expect(result.summary.critical).toBe(1);
    expect(result.summary.major).toBe(1);
    expect(result.summary.minor).toBe(1);
  });

  it('deduplicates dependent tags when task depends on multiple failed tasks', () => {
    const tasks = [
      makeTask({ id: 'T-1', status: 'done' }),
      makeTask({ id: 'T-2', status: 'done' }),
      makeTask({
        id: 'T-3',
        status: 'done',
        dependencies: [
          { taskId: 'T-1', type: 'blocks' },
          { taskId: 'T-2', type: 'blocks' },
        ],
      }),
    ];

    const result = executeQAFailBatch(
      tasks,
      [
        { taskId: 'T-1', testType: 'unit', description: 'Fail 1' },
        { taskId: 'T-2', testType: 'unit', description: 'Fail 2' },
      ],
      STATES,
      false,
    );

    // T-3 should be tagged once despite depending on both failed tasks
    expect(tasks[2].tags.filter((t) => t === 'qa-review-needed')).toHaveLength(1);
    expect(result.summary.dependentsTagged).toBe(1);
    // Pulled back only once
    expect(result.summary.dependentsPulledBack).toBe(1);
    expect(tasks[2].status).toBe('review');
  });

  it('handles mix of valid and invalid task IDs', () => {
    const tasks = [makeTask({ id: 'T-1', status: 'done' })];

    const result = executeQAFailBatch(
      tasks,
      [
        { taskId: 'T-1', testType: 'unit', description: 'Valid failure' },
        { taskId: 'T-999', testType: 'unit', description: 'Non-existent task' },
      ],
      STATES,
      false,
    );

    expect(result.entries).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].taskId).toBe('T-999');
    expect(result.errors[0].error).toContain('not found');
    expect(tasks[0].status).toBe('qa-failed');
  });

  it('collects transition errors without stopping other entries', () => {
    const tasks = [
      makeTask({ id: 'T-1', status: 'todo' }), // todo → qa-failed not allowed with enforcement
      makeTask({ id: 'T-2', status: 'done' }), // done → qa-failed allowed
    ];

    const result = executeQAFailBatch(
      tasks,
      [
        { taskId: 'T-1', testType: 'unit', description: 'Blocked by transition' },
        { taskId: 'T-2', testType: 'unit', description: 'Valid' },
      ],
      STATES,
      true, // enforce transitions
    );

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].taskId).toBe('T-2');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].taskId).toBe('T-1');
  });

  it('applies --force to bypass transition rules for all entries', () => {
    const tasks = [
      makeTask({ id: 'T-1', status: 'todo' }),
      makeTask({ id: 'T-2', status: 'todo' }),
    ];

    const result = executeQAFailBatch(
      tasks,
      [
        { taskId: 'T-1', testType: 'unit', description: 'Forced' },
        { taskId: 'T-2', testType: 'unit', description: 'Forced too' },
      ],
      STATES,
      true,
      { force: true },
    );

    expect(result.entries).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it('applies --cascade to all entries', () => {
    const tasks = [
      makeTask({
        id: 'T-1',
        status: 'done',
        children: [makeTask({ id: 'T-1.1', status: 'done' })],
      }),
      makeTask({
        id: 'T-2',
        status: 'done',
        children: [makeTask({ id: 'T-2.1', status: 'in-progress' })],
      }),
    ];

    const result = executeQAFailBatch(
      tasks,
      [
        { taskId: 'T-1', testType: 'unit', description: 'A' },
        { taskId: 'T-2', testType: 'unit', description: 'B' },
      ],
      STATES,
      false,
      { cascade: true },
    );

    expect(result.entries).toHaveLength(2);
    expect(tasks[0].children[0].status).toBe('qa-failed');
    expect(tasks[1].children[0].status).toBe('qa-failed');
  });

  it('applies default reporter when entry has none', () => {
    const tasks = [
      makeTask({ id: 'T-1', status: 'done' }),
      makeTask({ id: 'T-2', status: 'done' }),
    ];

    const result = executeQAFailBatch(
      tasks,
      [
        { taskId: 'T-1', testType: 'unit', description: 'A', reporter: 'custom-agent' },
        { taskId: 'T-2', testType: 'unit', description: 'B' },
      ],
      STATES,
      false,
    );

    expect(result.entries[0].feedbackEntry.reporter).toBe('custom-agent');
    expect(result.entries[1].feedbackEntry.reporter).toBe('qa-agent'); // default
  });

  it('recomputes readiness once for the batch (dependents auto-block)', () => {
    const tasks = [
      makeTask({ id: 'T-1', status: 'done' }),
      makeTask({ id: 'T-2', status: 'done' }),
      makeTask({
        id: 'T-3',
        status: 'todo',
        readiness: 'ready',
        dependencies: [{ taskId: 'T-1', type: 'blocks' }],
      }),
      makeTask({
        id: 'T-4',
        status: 'todo',
        readiness: 'ready',
        dependencies: [{ taskId: 'T-2', type: 'blocks' }],
      }),
    ];

    executeQAFailBatch(
      tasks,
      [
        { taskId: 'T-1', testType: 'unit', description: 'A' },
        { taskId: 'T-2', testType: 'unit', description: 'B' },
      ],
      STATES,
      false,
    );

    expect(tasks[2].readiness).toBe('blocked');
    expect(tasks[3].readiness).toBe('blocked');
  });

  it('throws if qa-failed state is not in the preset', () => {
    const simpleStates: StateDefinition[] = [
      { name: 'todo', category: 'open' },
      { name: 'done', category: 'closed' },
    ];
    const tasks = [makeTask({ id: 'T-1', status: 'done' })];

    expect(() =>
      executeQAFailBatch(
        tasks,
        [{ taskId: 'T-1', testType: 'unit', description: 'fail' }],
        simpleStates,
        false,
      ),
    ).toThrow('qa-failed');
  });
});
