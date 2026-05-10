import { describe, expect, it } from 'vitest';
import type { StateDefinition, TaskNode } from '../../../src/config/schema.js';
import { STANDARD_PRESET } from '../../../src/config/state-presets.js';
import {
  applyReadiness,
  buildDelegationManifest,
  findNextTask,
  recomputeAllReadiness,
  runValidation,
} from '../../../src/readiness/resolver.js';

/** Standard preset states for testing. */
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

// --- recomputeAllReadiness ---

describe('recomputeAllReadiness', () => {
  it('assigns pending to tasks with no dependencies', () => {
    const tasks = [makeTask({ id: 'A' }), makeTask({ id: 'B' })];
    const results = recomputeAllReadiness(tasks, STATES);
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.readiness).toBe('pending');
      expect(r.waitingOn).toEqual([]);
    }
  });

  it('assigns ready when all blocking deps are closed', () => {
    const tasks = [
      makeTask({
        id: 'A',
        dependencies: [{ taskId: 'B', type: 'blocks' }],
      }),
      makeTask({ id: 'B', status: 'done' }), // 'done' is closed in standard preset
    ];
    const results = recomputeAllReadiness(tasks, STATES);
    const resultA = results.find((r) => r.taskId === 'A');
    expect(resultA?.readiness).toBe('ready');
    expect(resultA?.waitingOn).toEqual([]);
  });

  it('assigns blocked when some deps are not closed', () => {
    const tasks = [
      makeTask({
        id: 'A',
        dependencies: [
          { taskId: 'B', type: 'blocks' },
          { taskId: 'C', type: 'blocks' },
        ],
      }),
      makeTask({ id: 'B', status: 'done' }),
      makeTask({ id: 'C', status: 'todo' }), // 'todo' is open, not closed
    ];
    const results = recomputeAllReadiness(tasks, STATES);
    const resultA = results.find((r) => r.taskId === 'A');
    expect(resultA?.readiness).toBe('blocked');
    expect(resultA?.waitingOn).toEqual(['C']);
  });

  it('ignores relates dependencies for readiness', () => {
    const tasks = [
      makeTask({
        id: 'A',
        dependencies: [{ taskId: 'B', type: 'relates' }],
      }),
      makeTask({ id: 'B', status: 'todo' }),
    ];
    const results = recomputeAllReadiness(tasks, STATES);
    const resultA = results.find((r) => r.taskId === 'A');
    // Only relates deps -> treated as no blocking deps -> pending
    expect(resultA?.readiness).toBe('pending');
  });

  it('handles produces dependency type (same as blocks for readiness)', () => {
    const tasks = [
      makeTask({
        id: 'A',
        dependencies: [{ taskId: 'B', type: 'produces' }],
      }),
      makeTask({ id: 'B', status: 'in-progress' }), // active, not closed
    ];
    const results = recomputeAllReadiness(tasks, STATES);
    const resultA = results.find((r) => r.taskId === 'A');
    expect(resultA?.readiness).toBe('blocked');
    expect(resultA?.waitingOn).toEqual(['B']);
  });

  it('handles mixed dep types: blocks closed + produces open = blocked', () => {
    const tasks = [
      makeTask({
        id: 'A',
        dependencies: [
          { taskId: 'B', type: 'blocks' },
          { taskId: 'C', type: 'produces' },
        ],
      }),
      makeTask({ id: 'B', status: 'done' }), // closed
      makeTask({ id: 'C', status: 'todo' }), // open
    ];
    const results = recomputeAllReadiness(tasks, STATES);
    const resultA = results.find((r) => r.taskId === 'A');
    expect(resultA?.readiness).toBe('blocked');
    expect(resultA?.waitingOn).toEqual(['C']);
  });

  it('treats dangling dependency refs as blocking', () => {
    const tasks = [
      makeTask({
        id: 'A',
        dependencies: [{ taskId: 'MISSING', type: 'blocks' }],
      }),
    ];
    const results = recomputeAllReadiness(tasks, STATES);
    const resultA = results.find((r) => r.taskId === 'A');
    expect(resultA?.readiness).toBe('blocked');
    expect(resultA?.waitingOn).toEqual(['MISSING']);
  });

  it('handles children — flattens and computes all', () => {
    const child = makeTask({
      id: 'A.1',
      dependencies: [{ taskId: 'B', type: 'blocks' }],
    });
    const parent = makeTask({ id: 'A', children: [child] });
    const taskB = makeTask({ id: 'B', status: 'done' });

    const results = recomputeAllReadiness([parent, taskB], STATES);
    const resultChild = results.find((r) => r.taskId === 'A.1');
    expect(resultChild?.readiness).toBe('ready');
  });
});

// --- applyReadiness ---

describe('applyReadiness', () => {
  it('updates task readiness fields in place', () => {
    const tasks = [makeTask({ id: 'A', readiness: 'pending' })];
    const results = [{ taskId: 'A', readiness: 'ready' as const, waitingOn: [] }];
    applyReadiness(tasks, results);
    expect(tasks[0].readiness).toBe('ready');
  });

  it('updates nested children via reference', () => {
    const child = makeTask({ id: 'A.1', readiness: 'pending' });
    const parent = makeTask({ id: 'A', readiness: 'pending', children: [child] });
    const results = [
      { taskId: 'A', readiness: 'ready' as const, waitingOn: [] },
      { taskId: 'A.1', readiness: 'blocked' as const, waitingOn: ['B'] },
    ];
    applyReadiness([parent], results);
    expect(parent.readiness).toBe('ready');
    expect(child.readiness).toBe('blocked');
  });
});

// --- buildDelegationManifest ---

describe('buildDelegationManifest', () => {
  it('builds manifest with ready and blocked tasks', () => {
    const tasks = [
      makeTask({
        id: 'A',
        status: 'todo',
        priority: 'high',
        requiredSkills: ['backend'],
        outputs: ['api'],
      }),
      makeTask({
        id: 'B',
        status: 'todo',
        dependencies: [{ taskId: 'A', type: 'blocks' }],
      }),
    ];

    const manifest = buildDelegationManifest(tasks, STATES);

    expect(manifest.generated_at).toBeTruthy();
    expect(manifest.ready_tasks).toHaveLength(1);
    expect(manifest.ready_tasks[0].id).toBe('A');
    expect(manifest.ready_tasks[0].required_skills).toEqual(['backend']);
    expect(manifest.ready_tasks[0].outputs).toEqual(['api']);
    expect(manifest.ready_tasks[0].dependencies).toEqual([]);

    expect(manifest.blocked_tasks).toHaveLength(1);
    expect(manifest.blocked_tasks[0].id).toBe('B');
    expect(manifest.blocked_tasks[0].waiting_on).toEqual(['A']);
  });

  it('excludes completed tasks from ready/blocked lists', () => {
    const tasks = [makeTask({ id: 'A', status: 'done' }), makeTask({ id: 'B', status: 'todo' })];

    const manifest = buildDelegationManifest(tasks, STATES);
    expect(manifest.ready_tasks.map((t) => t.id)).toEqual(['B']);
    expect(manifest.summary.completed).toBe(1);
  });

  it('produces correct summary counts', () => {
    const tasks = [
      makeTask({ id: 'A', status: 'todo' }),
      makeTask({ id: 'B', status: 'in-progress' }),
      makeTask({ id: 'C', status: 'done' }),
      makeTask({
        id: 'D',
        status: 'todo',
        dependencies: [{ taskId: 'B', type: 'blocks' }],
      }),
    ];

    const manifest = buildDelegationManifest(tasks, STATES);
    expect(manifest.summary.completed).toBe(1);
    expect(manifest.summary.in_progress).toBe(1);
    expect(manifest.summary.ready).toBeGreaterThanOrEqual(2); // A and B (pending/no blocking deps + in-progress with pending)
    expect(manifest.summary.blocked).toBeGreaterThanOrEqual(1); // D blocked by B
  });

  it('maps dependencies to taskId strings only', () => {
    const tasks = [
      makeTask({
        id: 'A',
        status: 'todo',
        dependencies: [{ taskId: 'B', type: 'blocks' }],
      }),
      makeTask({ id: 'B', status: 'done' }),
    ];

    const manifest = buildDelegationManifest(tasks, STATES);
    const taskA = manifest.ready_tasks.find((t) => t.id === 'A');
    expect(taskA?.dependencies).toEqual(['B']);
  });

  it('collects qa-failed tasks in dedicated section', () => {
    const tasks = [
      makeTask({
        id: 'A',
        status: 'qa-failed',
        priority: 'high',
        requiredSkills: ['backend'],
        qaFeedback: [
          {
            testType: 'unit',
            result: 'fail',
            description: 'Null pointer in parser',
            cause: 'Missing check',
            severity: 'critical',
            reporter: 'qa-agent',
            timestamp: '2026-02-01T00:00:00Z',
          },
        ],
      }),
      makeTask({ id: 'B', status: 'todo' }),
    ];

    const manifest = buildDelegationManifest(tasks, STATES);

    expect(manifest.qa_failed_tasks).toHaveLength(1);
    expect(manifest.qa_failed_tasks[0].id).toBe('A');
    expect(manifest.qa_failed_tasks[0].latest_feedback.test_type).toBe('unit');
    expect(manifest.qa_failed_tasks[0].latest_feedback.severity).toBe('critical');
    expect(manifest.summary.qa_failed).toBe(1);
    // A should not appear in ready_tasks
    expect(manifest.ready_tasks.map((t) => t.id)).not.toContain('A');
  });

  it('includes qa_failed count in summary', () => {
    const tasks = [
      makeTask({
        id: 'A',
        status: 'qa-failed',
        qaFeedback: [
          {
            testType: 'e2e',
            result: 'fail',
            description: 'fails',
            cause: '',
            severity: 'major',
            reporter: 'qa',
            timestamp: '',
          },
        ],
      }),
      makeTask({ id: 'B', status: 'todo' }),
      makeTask({ id: 'C', status: 'done' }),
    ];

    const manifest = buildDelegationManifest(tasks, STATES);
    expect(manifest.summary.qa_failed).toBe(1);
    expect(manifest.summary.completed).toBe(1);
    expect(manifest.summary.in_progress).toBe(1); // qa-failed counts as in_progress
  });
});

// --- findNextTask ---

describe('findNextTask', () => {
  it('returns highest priority ready task', () => {
    const tasks = [
      makeTask({ id: 'A', status: 'todo', priority: 'low' }),
      makeTask({ id: 'B', status: 'todo', priority: 'critical' }),
      makeTask({ id: 'C', status: 'todo', priority: 'medium' }),
    ];

    const next = findNextTask(tasks, STATES);
    expect(next?.id).toBe('B');
  });

  it('tie-breaks by task ID (lowest first)', () => {
    const tasks = [
      makeTask({ id: 'T-3', status: 'todo', priority: 'high' }),
      makeTask({ id: 'T-1', status: 'todo', priority: 'high' }),
      makeTask({ id: 'T-2', status: 'todo', priority: 'high' }),
    ];

    const next = findNextTask(tasks, STATES);
    expect(next?.id).toBe('T-1');
  });

  it('returns null when no ready tasks exist', () => {
    const tasks = [
      makeTask({
        id: 'A',
        status: 'todo',
        dependencies: [{ taskId: 'B', type: 'blocks' }],
      }),
      makeTask({ id: 'B', status: 'in-progress' }),
    ];

    const next = findNextTask(tasks, STATES);
    // A is blocked, B is active (not open)
    expect(next).toBeNull();
  });

  it('skips closed tasks', () => {
    const tasks = [
      makeTask({ id: 'A', status: 'done', priority: 'critical' }),
      makeTask({ id: 'B', status: 'todo', priority: 'low' }),
    ];

    const next = findNextTask(tasks, STATES);
    expect(next?.id).toBe('B');
  });

  it('only surfaces open-category tasks (not active)', () => {
    const tasks = [
      makeTask({ id: 'A', status: 'in-progress', priority: 'critical' }), // active category
      makeTask({ id: 'B', status: 'todo', priority: 'low' }), // open category
    ];

    const next = findNextTask(tasks, STATES);
    expect(next?.id).toBe('B');
  });

  it('returns null for empty task list', () => {
    const next = findNextTask([], STATES);
    expect(next).toBeNull();
  });

  it('returns qa-failed task with priority boost over regular tasks', () => {
    const tasks = [
      makeTask({ id: 'T-1', status: 'todo', priority: 'critical' }),
      makeTask({
        id: 'T-2',
        status: 'qa-failed',
        priority: 'low',
        qaFeedback: [
          {
            testType: 'unit',
            result: 'fail',
            description: 'fails',
            cause: '',
            severity: 'major',
            reporter: 'qa',
            timestamp: '',
          },
        ],
      }),
    ];

    const next = findNextTask(tasks, STATES);
    // qa-failed gets +10 bonus, so even low priority (1+10=11) beats critical (4)
    expect(next?.id).toBe('T-2');
  });

  it('returns qa-failed tasks even though they are active category', () => {
    const tasks = [
      makeTask({
        id: 'T-1',
        status: 'qa-failed',
        priority: 'medium',
        qaFeedback: [
          {
            testType: 'unit',
            result: 'fail',
            description: 'fails',
            cause: '',
            severity: 'major',
            reporter: 'qa',
            timestamp: '',
          },
        ],
      }),
    ];

    const next = findNextTask(tasks, STATES);
    expect(next?.id).toBe('T-1');
  });

  it('handles numeric ID sorting correctly', () => {
    const tasks = [
      makeTask({ id: 'T-10', status: 'todo', priority: 'high' }),
      makeTask({ id: 'T-2', status: 'todo', priority: 'high' }),
      makeTask({ id: 'T-9', status: 'todo', priority: 'high' }),
    ];

    const next = findNextTask(tasks, STATES);
    // With numeric locale compare: T-2 < T-9 < T-10
    expect(next?.id).toBe('T-2');
  });
});

// --- runValidation ---

describe('runValidation', () => {
  const vocabulary = ['backend', 'frontend', 'database', 'testing', 'devops'];

  it('reports clean graph as valid', () => {
    const tasks = [
      makeTask({ id: 'A', requiredSkills: ['backend'] }),
      makeTask({
        id: 'B',
        requiredSkills: ['frontend'],
        dependencies: [{ taskId: 'A', type: 'blocks' }],
      }),
    ];

    const report = runValidation(tasks, STATES, vocabulary, false);
    expect(report.isValid).toBe(true);
    expect(report.cycles.hasCycle).toBe(false);
    expect(report.danglingRefs).toEqual([]);
    expect(report.skillIssues).toEqual([]);
  });

  it('reports cycles', () => {
    const tasks = [
      makeTask({ id: 'A', dependencies: [{ taskId: 'B', type: 'blocks' }] }),
      makeTask({ id: 'B', dependencies: [{ taskId: 'A', type: 'blocks' }] }),
    ];

    const report = runValidation(tasks, STATES, vocabulary, false);
    expect(report.isValid).toBe(false);
    expect(report.cycles.hasCycle).toBe(true);
    expect(report.cycles.cycleNodes.sort()).toEqual(['A', 'B']);
  });

  it('reports dangling references', () => {
    const tasks = [makeTask({ id: 'A', dependencies: [{ taskId: 'MISSING', type: 'blocks' }] })];

    const report = runValidation(tasks, STATES, vocabulary, false);
    expect(report.isValid).toBe(false);
    expect(report.danglingRefs).toHaveLength(1);
    expect(report.danglingRefs[0].referencedId).toBe('MISSING');
  });

  it('reports skill vocabulary issues', () => {
    const tasks = [makeTask({ id: 'A', requiredSkills: ['graphql'] })];

    const report = runValidation(tasks, STATES, vocabulary, false);
    expect(report.isValid).toBe(false);
    expect(report.skillIssues).toHaveLength(1);
    expect(report.skillIssues[0].skill).toBe('graphql');
  });

  it('applies fixes for cycles and dangling refs when --fix is true', () => {
    const tasks = [
      makeTask({ id: 'A', dependencies: [{ taskId: 'B', type: 'blocks' }] }),
      makeTask({
        id: 'B',
        dependencies: [
          { taskId: 'A', type: 'blocks' },
          { taskId: 'MISSING', type: 'produces' },
        ],
      }),
    ];

    const report = runValidation(tasks, STATES, vocabulary, true);
    expect(report.fixes).toBeDefined();
    expect(report.fixes!.length).toBeGreaterThan(0);

    // After fix, cycles and dangling refs should be resolved
    expect(report.cycles.hasCycle).toBe(false);
    expect(report.danglingRefs).toEqual([]);
  });

  it('does not auto-fix skill issues', () => {
    const tasks = [makeTask({ id: 'A', requiredSkills: ['graphql'] })];

    const report = runValidation(tasks, STATES, vocabulary, true);
    // Skill issues remain even with --fix
    expect(report.skillIssues).toHaveLength(1);
    expect(report.isValid).toBe(false);
  });

  it('returns no fixes when graph is clean and fix is true', () => {
    const tasks = [makeTask({ id: 'A', requiredSkills: ['backend'] })];

    const report = runValidation(tasks, STATES, vocabulary, true);
    expect(report.isValid).toBe(true);
    expect(report.fixes).toBeUndefined();
  });
});
