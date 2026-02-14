import { describe, it, expect } from 'vitest';
import type { TaskNode, StateDefinition } from '../../../src/config/schema.js';
import { STANDARD_PRESET } from '../../../src/config/state-presets.js';
import { executeSetStatus, cascadeStatus } from '../../../src/commands/set-status.js';

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

// --- cascadeStatus ---

describe('cascadeStatus', () => {
  it('sets status on all direct children', () => {
    const task = makeTask({
      id: '1',
      children: [
        makeTask({ id: '1.1', status: 'todo' }),
        makeTask({ id: '1.2', status: 'in-progress' }),
      ],
    });
    const count = cascadeStatus(task, 'done');
    expect(count).toBe(2);
    expect(task.children[0].status).toBe('done');
    expect(task.children[1].status).toBe('done');
  });

  it('sets status recursively on all descendants', () => {
    const task = makeTask({
      id: '1',
      children: [
        makeTask({
          id: '1.1',
          status: 'todo',
          children: [
            makeTask({ id: '1.1.1', status: 'todo' }),
            makeTask({ id: '1.1.2', status: 'todo' }),
          ],
        }),
        makeTask({ id: '1.2', status: 'todo' }),
      ],
    });
    const count = cascadeStatus(task, 'done');
    expect(count).toBe(4);
    expect(task.children[0].status).toBe('done');
    expect(task.children[0].children[0].status).toBe('done');
    expect(task.children[0].children[1].status).toBe('done');
    expect(task.children[1].status).toBe('done');
  });

  it('returns 0 when task has no children', () => {
    const task = makeTask({ id: '1' });
    const count = cascadeStatus(task, 'done');
    expect(count).toBe(0);
  });
});

// --- executeSetStatus ---

describe('executeSetStatus', () => {
  it('changes task status', () => {
    const tasks = [makeTask({ id: '1', status: 'todo' })];
    const result = executeSetStatus(tasks, '1', 'in-progress', STATES, false);
    expect(result.oldStatus).toBe('todo');
    expect(result.newStatus).toBe('in-progress');
    expect(result.task.status).toBe('in-progress');
  });

  it('throws for non-existent task', () => {
    const tasks = [makeTask({ id: '1' })];
    expect(() =>
      executeSetStatus(tasks, '999', 'done', STATES, false),
    ).toThrow('Task "999" not found.');
  });

  it('throws for invalid target state', () => {
    const tasks = [makeTask({ id: '1' })];
    expect(() =>
      executeSetStatus(tasks, '1', 'invalid-state', STATES, false),
    ).toThrow('Invalid target state "invalid-state"');
  });

  it('force bypasses transition validation', () => {
    const tasks = [makeTask({ id: '1', status: 'todo' })];
    // Even if transitions are enforced, --force should bypass
    const result = executeSetStatus(tasks, '1', 'done', STATES, true, { force: true });
    expect(result.task.status).toBe('done');
  });

  it('force still validates target state exists', () => {
    const tasks = [makeTask({ id: '1', status: 'todo' })];
    expect(() =>
      executeSetStatus(tasks, '1', 'nonexistent', STATES, true, { force: true }),
    ).toThrow('Invalid target state "nonexistent"');
  });

  it('cascades status to all children', () => {
    const tasks = [
      makeTask({
        id: '1',
        status: 'todo',
        children: [
          makeTask({ id: '1.1', status: 'todo' }),
          makeTask({ id: '1.2', status: 'in-progress' }),
        ],
      }),
    ];
    const result = executeSetStatus(tasks, '1', 'done', STATES, false, { cascade: true });
    expect(result.cascadedCount).toBe(2);
    expect(result.task.children[0].status).toBe('done');
    expect(result.task.children[1].status).toBe('done');
  });

  it('cascadedCount is 0 when cascade not requested', () => {
    const tasks = [
      makeTask({
        id: '1',
        status: 'todo',
        children: [makeTask({ id: '1.1', status: 'todo' })],
      }),
    ];
    const result = executeSetStatus(tasks, '1', 'done', STATES, false);
    expect(result.cascadedCount).toBe(0);
    // Child should NOT be updated
    expect(result.task.children[0].status).toBe('todo');
  });

  it('recomputes readiness after status change', () => {
    // Task B depends on A. Set A to 'done' -> B should become ready.
    const tasks = [
      makeTask({ id: 'A', status: 'todo' }),
      makeTask({
        id: 'B',
        status: 'todo',
        readiness: 'blocked',
        dependencies: [{ taskId: 'A', type: 'blocks' }],
      }),
    ];
    const result = executeSetStatus(tasks, 'A', 'done', STATES, false);
    const taskB = result.tasks.find((t) => t.id === 'B');
    expect(taskB?.readiness).toBe('ready');
  });

  it('handles deeply nested cascade', () => {
    const tasks = [
      makeTask({
        id: '1',
        status: 'todo',
        children: [
          makeTask({
            id: '1.1',
            status: 'todo',
            children: [
              makeTask({
                id: '1.1.1',
                status: 'todo',
                children: [makeTask({ id: '1.1.1.1', status: 'todo' })],
              }),
            ],
          }),
        ],
      }),
    ];
    const result = executeSetStatus(tasks, '1', 'done', STATES, false, {
      cascade: true,
      force: true,
    });
    expect(result.cascadedCount).toBe(3);
    expect(result.task.status).toBe('done');
    expect(result.task.children[0].status).toBe('done');
    expect(result.task.children[0].children[0].status).toBe('done');
    expect(result.task.children[0].children[0].children[0].status).toBe('done');
  });
});
