import { describe, it, expect } from 'vitest';
import type { TaskNode } from '../../../src/config/schema.js';
import {
  flattenTasks,
  buildTaskMap,
  buildDag,
  detectDanglingRefs,
  fixCycles,
  fixDanglingRefs,
} from '../../../src/readiness/dag.js';

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

// --- flattenTasks ---

describe('flattenTasks', () => {
  it('returns flat list for tasks with no children', () => {
    const tasks = [makeTask({ id: 'A' }), makeTask({ id: 'B' })];
    const flat = flattenTasks(tasks);
    expect(flat.map((t) => t.id)).toEqual(['A', 'B']);
  });

  it('flattens one level of children', () => {
    const child = makeTask({ id: 'A.1' });
    const parent = makeTask({ id: 'A', children: [child] });
    const flat = flattenTasks([parent]);
    expect(flat.map((t) => t.id)).toEqual(['A', 'A.1']);
  });

  it('flattens deeply nested children (3+ levels)', () => {
    const grandchild = makeTask({ id: 'A.1.1' });
    const child = makeTask({ id: 'A.1', children: [grandchild] });
    const parent = makeTask({ id: 'A', children: [child] });
    const flat = flattenTasks([parent]);
    expect(flat.map((t) => t.id)).toEqual(['A', 'A.1', 'A.1.1']);
  });

  it('returns empty array for empty input', () => {
    expect(flattenTasks([])).toEqual([]);
  });

  it('returns references to original task objects (mutations propagate)', () => {
    const task = makeTask({ id: 'A', status: 'todo' });
    const flat = flattenTasks([task]);
    flat[0].status = 'done';
    expect(task.status).toBe('done');
  });

  it('flattens multiple top-level tasks with mixed children', () => {
    const tasks = [
      makeTask({ id: 'A', children: [makeTask({ id: 'A.1' })] }),
      makeTask({ id: 'B' }),
      makeTask({ id: 'C', children: [makeTask({ id: 'C.1' }), makeTask({ id: 'C.2' })] }),
    ];
    const flat = flattenTasks(tasks);
    expect(flat.map((t) => t.id)).toEqual(['A', 'A.1', 'B', 'C', 'C.1', 'C.2']);
  });
});

// --- buildTaskMap ---

describe('buildTaskMap', () => {
  it('builds correct key-value map', () => {
    const tasks = [makeTask({ id: 'A' }), makeTask({ id: 'B' }), makeTask({ id: 'C' })];
    const map = buildTaskMap(tasks);
    expect(map.size).toBe(3);
    expect(map.get('A')?.id).toBe('A');
    expect(map.get('B')?.id).toBe('B');
    expect(map.get('C')?.id).toBe('C');
  });

  it('handles empty array', () => {
    const map = buildTaskMap([]);
    expect(map.size).toBe(0);
  });

  it('last entry wins for duplicate IDs', () => {
    const t1 = makeTask({ id: 'A', title: 'First' });
    const t2 = makeTask({ id: 'A', title: 'Second' });
    const map = buildTaskMap([t1, t2]);
    expect(map.size).toBe(1);
    expect(map.get('A')?.title).toBe('Second');
  });
});

// --- buildDag (no cycles) ---

describe('buildDag - no cycles', () => {
  it('handles tasks with no dependencies', () => {
    const tasks = [makeTask({ id: 'A' }), makeTask({ id: 'B' })];
    const result = buildDag(tasks);
    expect(result.hasCycle).toBe(false);
    expect(result.sorted.length).toBe(2);
    expect(result.cycleNodes).toEqual([]);
  });

  it('sorts a linear chain correctly (A depends on B, B depends on C)', () => {
    const tasks = [
      makeTask({ id: 'A', dependencies: [{ taskId: 'B', type: 'blocks' }] }),
      makeTask({ id: 'B', dependencies: [{ taskId: 'C', type: 'blocks' }] }),
      makeTask({ id: 'C' }),
    ];
    const result = buildDag(tasks);
    expect(result.hasCycle).toBe(false);
    expect(result.sorted.length).toBe(3);
    // C should come before B, B before A
    const indexC = result.sorted.indexOf('C');
    const indexB = result.sorted.indexOf('B');
    const indexA = result.sorted.indexOf('A');
    expect(indexC).toBeLessThan(indexB);
    expect(indexB).toBeLessThan(indexA);
  });

  it('handles diamond dependency (A->B, A->C, B->D, C->D)', () => {
    const tasks = [
      makeTask({ id: 'A', dependencies: [{ taskId: 'B', type: 'blocks' }, { taskId: 'C', type: 'blocks' }] }),
      makeTask({ id: 'B', dependencies: [{ taskId: 'D', type: 'blocks' }] }),
      makeTask({ id: 'C', dependencies: [{ taskId: 'D', type: 'blocks' }] }),
      makeTask({ id: 'D' }),
    ];
    const result = buildDag(tasks);
    expect(result.hasCycle).toBe(false);
    expect(result.sorted.length).toBe(4);
    // D should come first, A should come last
    const indexD = result.sorted.indexOf('D');
    const indexA = result.sorted.indexOf('A');
    expect(indexD).toBeLessThan(indexA);
  });

  it('includes produces edges in DAG', () => {
    const tasks = [
      makeTask({ id: 'A', dependencies: [{ taskId: 'B', type: 'produces' }] }),
      makeTask({ id: 'B' }),
    ];
    const result = buildDag(tasks);
    expect(result.hasCycle).toBe(false);
    expect(result.sorted.length).toBe(2);
    expect(result.sorted.indexOf('B')).toBeLessThan(result.sorted.indexOf('A'));
  });
});

// --- buildDag (cycle detection) ---

describe('buildDag - cycle detection', () => {
  it('detects a simple cycle (A->B, B->A)', () => {
    const tasks = [
      makeTask({ id: 'A', dependencies: [{ taskId: 'B', type: 'blocks' }] }),
      makeTask({ id: 'B', dependencies: [{ taskId: 'A', type: 'blocks' }] }),
    ];
    const result = buildDag(tasks);
    expect(result.hasCycle).toBe(true);
    expect(result.cycleNodes.sort()).toEqual(['A', 'B']);
  });

  it('detects a triangle cycle (A->B->C->A)', () => {
    const tasks = [
      makeTask({ id: 'A', dependencies: [{ taskId: 'B', type: 'blocks' }] }),
      makeTask({ id: 'B', dependencies: [{ taskId: 'C', type: 'blocks' }] }),
      makeTask({ id: 'C', dependencies: [{ taskId: 'A', type: 'blocks' }] }),
    ];
    const result = buildDag(tasks);
    expect(result.hasCycle).toBe(true);
    expect(result.cycleNodes.sort()).toEqual(['A', 'B', 'C']);
  });

  it('detects self-reference', () => {
    const tasks = [
      makeTask({ id: 'A', dependencies: [{ taskId: 'A', type: 'blocks' }] }),
    ];
    const result = buildDag(tasks);
    expect(result.hasCycle).toBe(true);
    expect(result.cycleNodes).toEqual(['A']);
  });

  it('detects cycle even with relates type', () => {
    const tasks = [
      makeTask({ id: 'A', dependencies: [{ taskId: 'B', type: 'relates' }] }),
      makeTask({ id: 'B', dependencies: [{ taskId: 'A', type: 'relates' }] }),
    ];
    const result = buildDag(tasks);
    expect(result.hasCycle).toBe(true);
    expect(result.cycleNodes.sort()).toEqual(['A', 'B']);
  });

  it('isolates cycle nodes — non-cycle nodes are sorted', () => {
    const tasks = [
      makeTask({ id: 'A', dependencies: [{ taskId: 'B', type: 'blocks' }] }),
      makeTask({ id: 'B', dependencies: [{ taskId: 'A', type: 'blocks' }] }),
      makeTask({ id: 'C' }), // Not part of cycle
    ];
    const result = buildDag(tasks);
    expect(result.hasCycle).toBe(true);
    expect(result.sorted).toContain('C');
    expect(result.sorted).not.toContain('A');
    expect(result.sorted).not.toContain('B');
    expect(result.cycleNodes.sort()).toEqual(['A', 'B']);
  });
});

// --- detectDanglingRefs ---

describe('detectDanglingRefs', () => {
  it('returns empty for valid references', () => {
    const flat = [
      makeTask({ id: 'A', dependencies: [{ taskId: 'B', type: 'blocks' }] }),
      makeTask({ id: 'B' }),
    ];
    const taskMap = buildTaskMap(flat);
    const result = detectDanglingRefs(flat, taskMap);
    expect(result.danglingRefs).toEqual([]);
  });

  it('detects reference to non-existent task', () => {
    const flat = [
      makeTask({ id: 'A', dependencies: [{ taskId: 'MISSING', type: 'blocks' }] }),
    ];
    const taskMap = buildTaskMap(flat);
    const result = detectDanglingRefs(flat, taskMap);
    expect(result.danglingRefs).toHaveLength(1);
    expect(result.danglingRefs[0]).toEqual({
      taskId: 'A',
      referencedId: 'MISSING',
      depIndex: 0,
    });
  });

  it('detects multiple dangling refs across tasks', () => {
    const flat = [
      makeTask({
        id: 'A',
        dependencies: [
          { taskId: 'B', type: 'blocks' },
          { taskId: 'GHOST', type: 'produces' },
        ],
      }),
      makeTask({ id: 'B', dependencies: [{ taskId: 'PHANTOM', type: 'blocks' }] }),
    ];
    const taskMap = buildTaskMap(flat);
    const result = detectDanglingRefs(flat, taskMap);
    expect(result.danglingRefs).toHaveLength(2);
    expect(result.danglingRefs.map((r) => r.referencedId).sort()).toEqual(['GHOST', 'PHANTOM']);
  });

  it('returns correct depIndex for mixed valid/invalid deps', () => {
    const flat = [
      makeTask({
        id: 'A',
        dependencies: [
          { taskId: 'B', type: 'blocks' },
          { taskId: 'MISSING', type: 'produces' },
        ],
      }),
      makeTask({ id: 'B' }),
    ];
    const taskMap = buildTaskMap(flat);
    const result = detectDanglingRefs(flat, taskMap);
    expect(result.danglingRefs).toHaveLength(1);
    expect(result.danglingRefs[0].depIndex).toBe(1);
  });

  it('handles tasks with no dependencies', () => {
    const flat = [makeTask({ id: 'A' })];
    const taskMap = buildTaskMap(flat);
    const result = detectDanglingRefs(flat, taskMap);
    expect(result.danglingRefs).toEqual([]);
  });
});

// --- fixCycles ---

describe('fixCycles', () => {
  it('returns empty array when no cycle', () => {
    const tasks = [makeTask({ id: 'A' }), makeTask({ id: 'B' })];
    const dagResult = buildDag(tasks);
    const fixes = fixCycles(tasks, dagResult);
    expect(fixes).toEqual([]);
  });

  it('removes back-edge to break a simple cycle', () => {
    const tasks = [
      makeTask({ id: 'A', dependencies: [{ taskId: 'B', type: 'blocks' }] }),
      makeTask({ id: 'B', dependencies: [{ taskId: 'A', type: 'blocks' }] }),
    ];
    const dagResult = buildDag(tasks);
    const fixes = fixCycles(tasks, dagResult);

    expect(fixes.length).toBeGreaterThan(0);
    expect(fixes[0].type).toBe('removed_cycle_edge');

    // After fix, at least one task should have had its dependency removed
    const totalDeps = tasks[0].dependencies.length + tasks[1].dependencies.length;
    expect(totalDeps).toBeLessThan(2); // Was 2, at least 1 removed
  });

  it('mutates task dependencies in place', () => {
    const taskA = makeTask({ id: 'A', dependencies: [{ taskId: 'B', type: 'blocks' }] });
    const taskB = makeTask({ id: 'B', dependencies: [{ taskId: 'A', type: 'blocks' }] });
    const tasks = [taskA, taskB];

    const dagResult = buildDag(tasks);
    fixCycles(tasks, dagResult);

    // At least one dependency should have been removed
    const remaining = taskA.dependencies.length + taskB.dependencies.length;
    expect(remaining).toBeLessThan(2);
  });

  it('reports fix actions with detail', () => {
    const tasks = [
      makeTask({ id: 'A', dependencies: [{ taskId: 'B', type: 'blocks' }] }),
      makeTask({ id: 'B', dependencies: [{ taskId: 'A', type: 'blocks' }] }),
    ];
    const dagResult = buildDag(tasks);
    const fixes = fixCycles(tasks, dagResult);

    for (const fix of fixes) {
      expect(fix.type).toBe('removed_cycle_edge');
      expect(fix.taskId).toBeTruthy();
      expect(fix.detail).toContain('Removed dependency');
    }
  });
});

// --- fixDanglingRefs ---

describe('fixDanglingRefs', () => {
  it('returns empty array when no dangling refs', () => {
    const tasks = [makeTask({ id: 'A' })];
    const orphanResult = { danglingRefs: [] };
    const fixes = fixDanglingRefs(tasks, orphanResult);
    expect(fixes).toEqual([]);
  });

  it('removes invalid dependency entry', () => {
    const task = makeTask({
      id: 'A',
      dependencies: [
        { taskId: 'B', type: 'blocks' },
        { taskId: 'MISSING', type: 'produces' },
      ],
    });
    const tasks = [task, makeTask({ id: 'B' })];
    const orphanResult = {
      danglingRefs: [{ taskId: 'A', referencedId: 'MISSING', depIndex: 1 }],
    };

    const fixes = fixDanglingRefs(tasks, orphanResult);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].type).toBe('removed_dangling');
    expect(task.dependencies).toHaveLength(1);
    expect(task.dependencies[0].taskId).toBe('B');
  });

  it('handles multiple dangling refs in same task (descending index order)', () => {
    const task = makeTask({
      id: 'A',
      dependencies: [
        { taskId: 'GHOST1', type: 'blocks' },
        { taskId: 'B', type: 'blocks' },
        { taskId: 'GHOST2', type: 'produces' },
      ],
    });
    const tasks = [task, makeTask({ id: 'B' })];
    const orphanResult = {
      danglingRefs: [
        { taskId: 'A', referencedId: 'GHOST1', depIndex: 0 },
        { taskId: 'A', referencedId: 'GHOST2', depIndex: 2 },
      ],
    };

    const fixes = fixDanglingRefs(tasks, orphanResult);
    expect(fixes).toHaveLength(2);
    expect(task.dependencies).toHaveLength(1);
    expect(task.dependencies[0].taskId).toBe('B');
  });

  it('reports fix actions with detail', () => {
    const task = makeTask({
      id: 'A',
      dependencies: [{ taskId: 'MISSING', type: 'blocks' }],
    });
    const tasks = [task];
    const orphanResult = {
      danglingRefs: [{ taskId: 'A', referencedId: 'MISSING', depIndex: 0 }],
    };

    const fixes = fixDanglingRefs(tasks, orphanResult);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].type).toBe('removed_dangling');
    expect(fixes[0].detail).toContain('MISSING');
  });
});
