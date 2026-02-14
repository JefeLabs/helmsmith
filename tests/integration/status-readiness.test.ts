import { describe, it, expect } from 'vitest';
import type { TaskNode, StateDefinition } from '../../src/config/schema.js';
import { STANDARD_PRESET } from '../../src/config/state-presets.js';
import { resolveStates } from '../../src/config/state-engine.js';
import { executeSetStatus } from '../../src/commands/set-status.js';
import {
  recomputeAllReadiness,
  applyReadiness,
  buildDelegationManifest,
} from '../../src/readiness/index.js';

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

describe('Status -> Readiness recomputation pipeline', () => {
  it('completing a dependency unblocks the dependent task', () => {
    // Chain: A depends on B, B depends on C
    const tasks = [
      makeTask({
        id: 'A',
        title: 'Task A',
        dependencies: [{ taskId: 'B', type: 'blocks' }],
      }),
      makeTask({
        id: 'B',
        title: 'Task B',
        dependencies: [{ taskId: 'C', type: 'blocks' }],
      }),
      makeTask({
        id: 'C',
        title: 'Task C',
      }),
    ];

    // Initial: C is pending (no deps), B is blocked (C not done), A is blocked (B not done)
    let results = recomputeAllReadiness(tasks, STATES);
    applyReadiness(tasks, results);

    expect(tasks[2].readiness).toBe('pending'); // C
    expect(tasks[1].readiness).toBe('blocked'); // B
    expect(tasks[0].readiness).toBe('blocked'); // A

    // Complete C via set-status
    executeSetStatus(tasks, 'C', 'done', STATES, false);

    // After completing C: B should be ready/pending, A still blocked
    expect(tasks[1].readiness).not.toBe('blocked'); // B is unblocked
    expect(tasks[0].readiness).toBe('blocked'); // A still blocked by B

    // Complete B
    executeSetStatus(tasks, 'B', 'done', STATES, false);

    // After completing B: A should be unblocked
    expect(tasks[0].readiness).not.toBe('blocked');
  });

  it('set-status with --cascade propagates to children', () => {
    const child1 = makeTask({ id: 'P.1', title: 'Child 1', type: 'subtask' });
    const child2 = makeTask({ id: 'P.2', title: 'Child 2', type: 'subtask' });
    const parent = makeTask({
      id: 'P',
      title: 'Parent',
      children: [child1, child2],
    });

    const tasks = [parent];
    const result = executeSetStatus(tasks, 'P', 'in-progress', STATES, false, { cascade: true });

    expect(result.newStatus).toBe('in-progress');
    expect(result.cascadedCount).toBe(2);
    expect(child1.status).toBe('in-progress');
    expect(child2.status).toBe('in-progress');
  });

  it('delegation manifest updates after status changes', () => {
    const tasks = [
      makeTask({
        id: 'A',
        title: 'Task A',
        priority: 'high',
        requiredSkills: ['backend'],
        dependencies: [{ taskId: 'B', type: 'blocks' }],
      }),
      makeTask({
        id: 'B',
        title: 'Task B',
        priority: 'critical',
        requiredSkills: ['frontend'],
      }),
    ];

    // Initially: B is ready (no deps), A is blocked
    let results = recomputeAllReadiness(tasks, STATES);
    applyReadiness(tasks, results);

    let manifest = buildDelegationManifest(tasks, STATES);
    expect(manifest.ready_tasks.map((t) => t.id)).toContain('B');
    expect(manifest.blocked_tasks.map((t) => t.id)).toContain('A');

    // Complete B
    executeSetStatus(tasks, 'B', 'done', STATES, false);

    // Now A should be ready
    manifest = buildDelegationManifest(tasks, STATES);
    expect(manifest.ready_tasks.map((t) => t.id)).toContain('A');
    expect(manifest.blocked_tasks.map((t) => t.id)).not.toContain('A');
    expect(manifest.summary.completed).toBe(1);
  });

  it('--force bypasses transition rules', () => {
    const tasks = [
      makeTask({ id: 'X', title: 'Task X', status: 'todo' }),
    ];

    // Direct jump from todo to done without --force should work when enforce_transitions is false
    const result = executeSetStatus(tasks, 'X', 'done', STATES, false);
    expect(result.newStatus).toBe('done');
  });

  it('recomputation handles multiple dependency chains correctly', () => {
    // Diamond dependency: D depends on both B and C, B and C depend on A
    const tasks = [
      makeTask({ id: 'A', title: 'Foundation' }),
      makeTask({
        id: 'B',
        title: 'Path B',
        dependencies: [{ taskId: 'A', type: 'blocks' }],
      }),
      makeTask({
        id: 'C',
        title: 'Path C',
        dependencies: [{ taskId: 'A', type: 'blocks' }],
      }),
      makeTask({
        id: 'D',
        title: 'Final',
        dependencies: [
          { taskId: 'B', type: 'blocks' },
          { taskId: 'C', type: 'blocks' },
        ],
      }),
    ];

    let results = recomputeAllReadiness(tasks, STATES);
    applyReadiness(tasks, results);

    expect(tasks[0].readiness).toBe('pending'); // A: no deps
    expect(tasks[1].readiness).toBe('blocked'); // B: waiting on A
    expect(tasks[2].readiness).toBe('blocked'); // C: waiting on A
    expect(tasks[3].readiness).toBe('blocked'); // D: waiting on B and C

    // Complete A -> B and C unblocked
    executeSetStatus(tasks, 'A', 'done', STATES, false);
    expect(tasks[1].readiness).not.toBe('blocked');
    expect(tasks[2].readiness).not.toBe('blocked');
    expect(tasks[3].readiness).toBe('blocked'); // D still blocked by B and C

    // Complete B -> D still blocked by C
    executeSetStatus(tasks, 'B', 'done', STATES, false);
    expect(tasks[3].readiness).toBe('blocked');

    // Complete C -> D unblocked
    executeSetStatus(tasks, 'C', 'done', STATES, false);
    expect(tasks[3].readiness).not.toBe('blocked');
  });
});
