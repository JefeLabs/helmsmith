import { describe, it, expect } from 'vitest';
import type { TaskNode, StateDefinition } from '../../../src/config/schema.js';
import { STANDARD_PRESET } from '../../../src/config/state-presets.js';
import {
  executeRemove,
  collectDescendantIds,
  removeFromTree,
  cleanupDependencies,
} from '../../../src/commands/remove.js';

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

// --- collectDescendantIds ---

describe('collectDescendantIds', () => {
  it('returns just the task ID when no children', () => {
    const task = makeTask({ id: '3' });
    expect(collectDescendantIds(task)).toEqual(['3']);
  });

  it('returns all descendant IDs recursively', () => {
    const task = makeTask({
      id: '1',
      children: [
        makeTask({
          id: '1.1',
          children: [makeTask({ id: '1.1.1' })],
        }),
        makeTask({ id: '1.2' }),
      ],
    });
    const ids = collectDescendantIds(task);
    expect(ids).toEqual(['1', '1.1', '1.1.1', '1.2']);
  });
});

// --- removeFromTree ---

describe('removeFromTree', () => {
  it('removes a top-level task', () => {
    const tasks = [makeTask({ id: '1' }), makeTask({ id: '2' }), makeTask({ id: '3' })];
    const result = removeFromTree(tasks, '2');
    expect(result).toBe(true);
    expect(tasks).toHaveLength(2);
    expect(tasks.map((t) => t.id)).toEqual(['1', '3']);
  });

  it('removes a nested child task', () => {
    const parent = makeTask({
      id: '1',
      children: [makeTask({ id: '1.1' }), makeTask({ id: '1.2' })],
    });
    const tasks = [parent];
    const result = removeFromTree(tasks, '1.1');
    expect(result).toBe(true);
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].id).toBe('1.2');
  });

  it('removes a deeply nested child task', () => {
    const tasks = [
      makeTask({
        id: '1',
        children: [
          makeTask({
            id: '1.1',
            children: [makeTask({ id: '1.1.1' }), makeTask({ id: '1.1.2' })],
          }),
        ],
      }),
    ];
    const result = removeFromTree(tasks, '1.1.1');
    expect(result).toBe(true);
    expect(tasks[0].children[0].children).toHaveLength(1);
    expect(tasks[0].children[0].children[0].id).toBe('1.1.2');
  });

  it('returns false when task is not found', () => {
    const tasks = [makeTask({ id: '1' })];
    const result = removeFromTree(tasks, '999');
    expect(result).toBe(false);
    expect(tasks).toHaveLength(1);
  });
});

// --- cleanupDependencies ---

describe('cleanupDependencies', () => {
  it('removes dependency references to removed IDs', () => {
    const tasks = [
      makeTask({
        id: 'A',
        dependencies: [
          { taskId: 'B', type: 'blocks' },
          { taskId: 'C', type: 'relates' },
        ],
      }),
      makeTask({ id: 'C' }),
    ];
    cleanupDependencies(tasks, new Set(['B']));
    expect(tasks[0].dependencies).toHaveLength(1);
    expect(tasks[0].dependencies[0].taskId).toBe('C');
  });

  it('removes all dependency types (blocks, produces, relates)', () => {
    const tasks = [
      makeTask({
        id: 'A',
        dependencies: [
          { taskId: 'X', type: 'blocks' },
          { taskId: 'X', type: 'produces' },
          { taskId: 'X', type: 'relates' },
          { taskId: 'Y', type: 'blocks' },
        ],
      }),
      makeTask({ id: 'Y' }),
    ];
    cleanupDependencies(tasks, new Set(['X']));
    expect(tasks[0].dependencies).toHaveLength(1);
    expect(tasks[0].dependencies[0].taskId).toBe('Y');
  });

  it('cleans up dependencies in nested children', () => {
    const tasks = [
      makeTask({
        id: '1',
        children: [
          makeTask({
            id: '1.1',
            dependencies: [
              { taskId: 'REMOVED', type: 'blocks' },
              { taskId: '2', type: 'blocks' },
            ],
          }),
        ],
      }),
      makeTask({ id: '2' }),
    ];
    cleanupDependencies(tasks, new Set(['REMOVED']));
    expect(tasks[0].children[0].dependencies).toHaveLength(1);
    expect(tasks[0].children[0].dependencies[0].taskId).toBe('2');
  });
});

// --- executeRemove ---

describe('executeRemove', () => {
  it('removes a top-level task and returns removed IDs', () => {
    const tasks = [makeTask({ id: '1' }), makeTask({ id: '2' })];
    const result = executeRemove(tasks, '1', STATES);
    expect(result.removedIds).toEqual(['1']);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].id).toBe('2');
  });

  it('removes a task with children and returns all removed IDs', () => {
    const tasks = [
      makeTask({
        id: '1',
        children: [
          makeTask({ id: '1.1' }),
          makeTask({ id: '1.2', children: [makeTask({ id: '1.2.1' })] }),
        ],
      }),
      makeTask({ id: '2' }),
    ];
    const result = executeRemove(tasks, '1', STATES);
    expect(result.removedIds).toEqual(['1', '1.1', '1.2', '1.2.1']);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].id).toBe('2');
  });

  it('cleans up dependencies referencing the removed task', () => {
    const tasks = [
      makeTask({ id: '1' }),
      makeTask({
        id: '2',
        dependencies: [{ taskId: '1', type: 'blocks' }],
      }),
    ];
    const result = executeRemove(tasks, '1', STATES);
    expect(result.tasks[0].dependencies).toEqual([]);
  });

  it('cleans up dependencies referencing descendant IDs', () => {
    const tasks = [
      makeTask({
        id: '1',
        children: [makeTask({ id: '1.1' })],
      }),
      makeTask({
        id: '2',
        dependencies: [
          { taskId: '1.1', type: 'produces' },
          { taskId: '3', type: 'blocks' },
        ],
      }),
      makeTask({ id: '3' }),
    ];
    const result = executeRemove(tasks, '1', STATES);
    const task2 = result.tasks.find((t) => t.id === '2');
    expect(task2?.dependencies).toHaveLength(1);
    expect(task2?.dependencies[0].taskId).toBe('3');
  });

  it('throws for non-existent task', () => {
    const tasks = [makeTask({ id: '1' })];
    expect(() => executeRemove(tasks, '999', STATES)).toThrow('Task "999" not found.');
  });

  it('recomputes readiness after removal', () => {
    // Task A blocks B. Remove A -> B should become pending (no deps left)
    const tasks = [
      makeTask({ id: 'A', status: 'todo' }),
      makeTask({
        id: 'B',
        status: 'todo',
        readiness: 'blocked',
        dependencies: [{ taskId: 'A', type: 'blocks' }],
      }),
    ];
    const result = executeRemove(tasks, 'A', STATES);
    const taskB = result.tasks.find((t) => t.id === 'B');
    expect(taskB?.readiness).toBe('pending');
    expect(taskB?.dependencies).toEqual([]);
  });
});
