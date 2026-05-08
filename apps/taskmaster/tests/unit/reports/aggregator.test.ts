import { describe, it, expect } from 'vitest';
import type { TaskNode, StateDefinition } from '../../../src/config/schema.js';
import { STANDARD_PRESET } from '../../../src/config/state-presets.js';
import {
  aggregateSummary,
  aggregateComplexity,
  aggregateProgress,
  aggregateDependencies,
  generateMermaidSyntax,
} from '../../../src/reports/aggregator.js';

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

// --- aggregateComplexity ---

describe('aggregateComplexity', () => {
  it('returns zeros for empty task array', () => {
    const result = aggregateComplexity([]);
    expect(result.summary).toEqual({ low: 0, medium: 0, high: 0, average: 0 });
    expect(result.tasks).toHaveLength(0);
  });

  it('classifies tasks into correct complexity bands', () => {
    const tasks = [
      makeTask({ id: 'A', complexity: 1 }),
      makeTask({ id: 'B', complexity: 3 }),
      makeTask({ id: 'C', complexity: 5 }),
      makeTask({ id: 'D', complexity: 7 }),
      makeTask({ id: 'E', complexity: 10 }),
    ];
    const result = aggregateComplexity(tasks);
    expect(result.summary.low).toBe(2);   // 1, 3
    expect(result.summary.medium).toBe(1); // 5
    expect(result.summary.high).toBe(2);   // 7, 10
  });

  it('computes correct average', () => {
    const tasks = [
      makeTask({ id: 'A', complexity: 2 }),
      makeTask({ id: 'B', complexity: 4 }),
      makeTask({ id: 'C', complexity: 6 }),
    ];
    const result = aggregateComplexity(tasks);
    // (2 + 4 + 6) / 3 = 4.0
    expect(result.summary.average).toBe(4);
  });

  it('rounds average to one decimal place', () => {
    const tasks = [
      makeTask({ id: 'A', complexity: 1 }),
      makeTask({ id: 'B', complexity: 2 }),
      makeTask({ id: 'C', complexity: 3 }),
    ];
    const result = aggregateComplexity(tasks);
    // (1 + 2 + 3) / 3 = 2.0
    expect(result.summary.average).toBe(2);
  });

  it('includes flattened children in computation', () => {
    const parent = makeTask({
      id: 'P',
      complexity: 8,
      children: [
        makeTask({ id: 'C1', complexity: 2 }),
        makeTask({ id: 'C2', complexity: 4 }),
      ],
    });
    const result = aggregateComplexity([parent]);
    expect(result.tasks).toHaveLength(3);
    expect(result.summary.high).toBe(1);   // P = 8
    expect(result.summary.low).toBe(1);    // C1 = 2
    expect(result.summary.medium).toBe(1); // C2 = 4
  });

  it('handles all tasks with same score', () => {
    const tasks = [
      makeTask({ id: 'A', complexity: 5 }),
      makeTask({ id: 'B', complexity: 5 }),
    ];
    const result = aggregateComplexity(tasks);
    expect(result.summary).toEqual({ low: 0, medium: 2, high: 0, average: 5 });
  });
});

// --- aggregateProgress ---

describe('aggregateProgress', () => {
  it('returns zeros for empty task array', () => {
    const result = aggregateProgress([], STATES);
    expect(result.progress).toEqual({
      total: 0, done: 0, inProgress: 0, blocked: 0, pending: 0, percentage: 0,
    });
  });

  it('counts tasks by category correctly', () => {
    const tasks = [
      makeTask({ id: 'A', status: 'done' }),       // closed
      makeTask({ id: 'B', status: 'done' }),       // closed
      makeTask({ id: 'C', status: 'in-progress' }), // active
      makeTask({ id: 'D', status: 'todo', readiness: 'blocked' }), // open + blocked
      makeTask({ id: 'E', status: 'todo', readiness: 'pending' }), // open + pending
    ];
    const result = aggregateProgress(tasks, STATES);
    expect(result.progress.done).toBe(2);
    expect(result.progress.inProgress).toBe(1);
    expect(result.progress.blocked).toBe(1);
    expect(result.progress.pending).toBe(1);
    expect(result.progress.total).toBe(5);
    expect(result.progress.percentage).toBe(40); // 2/5 = 40%
  });

  it('computes 100% when all tasks are done', () => {
    const tasks = [
      makeTask({ id: 'A', status: 'done' }),
      makeTask({ id: 'B', status: 'done' }),
    ];
    const result = aggregateProgress(tasks, STATES);
    expect(result.progress.percentage).toBe(100);
    expect(result.progress.done).toBe(2);
    expect(result.progress.pending).toBe(0);
  });

  it('includes children in progress counts', () => {
    const parent = makeTask({
      id: 'P',
      status: 'in-progress',
      children: [
        makeTask({ id: 'C1', status: 'done' }),
        makeTask({ id: 'C2', status: 'todo', readiness: 'pending' }),
      ],
    });
    const result = aggregateProgress([parent], STATES);
    expect(result.progress.total).toBe(3);
    expect(result.progress.done).toBe(1);
    expect(result.progress.inProgress).toBe(1);
    expect(result.progress.pending).toBe(1);
  });
});

// --- aggregateDependencies ---

describe('aggregateDependencies', () => {
  it('returns flattened tasks and mermaid syntax', () => {
    const tasks = [
      makeTask({
        id: 'A',
        dependencies: [{ taskId: 'B', type: 'blocks' }],
      }),
      makeTask({ id: 'B' }),
    ];
    const result = aggregateDependencies(tasks);
    expect(result.tasks).toHaveLength(2);
    expect(result.mermaidSyntax).toContain('graph LR');
    expect(result.mermaidSyntax).toContain('B["B"] --> A["A"]');
  });

  it('shows isolated nodes when no dependencies exist', () => {
    const tasks = [
      makeTask({ id: 'A' }),
      makeTask({ id: 'B' }),
    ];
    const result = aggregateDependencies(tasks);
    expect(result.mermaidSyntax).toContain('A["A"]');
    expect(result.mermaidSyntax).toContain('B["B"]');
    expect(result.mermaidSyntax).not.toContain('-->');
  });
});

// --- generateMermaidSyntax ---

describe('generateMermaidSyntax', () => {
  it('starts with graph LR', () => {
    const result = generateMermaidSyntax([]);
    expect(result).toBe('graph LR');
  });

  it('generates correct edges for dependencies', () => {
    const tasks = [
      makeTask({
        id: 'T2',
        dependencies: [
          { taskId: 'T1', type: 'blocks' },
          { taskId: 'T3', type: 'produces' },
        ],
      }),
      makeTask({ id: 'T1' }),
      makeTask({ id: 'T3' }),
    ];
    const result = generateMermaidSyntax(tasks);
    expect(result).toContain('T1["T1"] --> T2["T2"]');
    expect(result).toContain('T3["T3"] --> T2["T2"]');
  });

  it('handles tasks with no dependencies as isolated nodes', () => {
    const tasks = [makeTask({ id: 'X' })];
    const result = generateMermaidSyntax(tasks);
    expect(result).toContain('X["X"]');
    expect(result).not.toContain('-->');
  });
});

// --- aggregateSummary ---

describe('aggregateSummary', () => {
  it('returns correct structure for empty tasks', () => {
    const result = aggregateSummary([], STATES);
    expect(result.taskCounts).toEqual({ total: 0, open: 0, active: 0, closed: 0 });
    expect(result.complexity).toEqual({ low: 0, medium: 0, high: 0, average: 0 });
    expect(result.skillCoverage).toEqual([]);
    expect(result.readiness).toEqual({ ready: 0, blocked: 0, pending: 0 });
    expect(result.blockedAlerts).toEqual([]);
    expect(result.progressPercentage).toBe(0);
    expect(result.generatedAt).toBeTruthy();
  });

  it('computes all summary sections correctly', () => {
    const tasks = [
      makeTask({
        id: 'A',
        status: 'done',
        complexity: 2,
        requiredSkills: ['backend', 'database'],
        readiness: 'ready',
      }),
      makeTask({
        id: 'B',
        status: 'in-progress',
        complexity: 5,
        requiredSkills: ['frontend'],
        readiness: 'ready',
      }),
      makeTask({
        id: 'C',
        status: 'todo',
        complexity: 8,
        requiredSkills: ['backend'],
        readiness: 'blocked',
        dependencies: [{ taskId: 'B', type: 'blocks' }],
      }),
      makeTask({
        id: 'D',
        status: 'todo',
        complexity: 3,
        requiredSkills: ['frontend', 'backend'],
        readiness: 'pending',
      }),
    ];

    const result = aggregateSummary(tasks, STATES);

    // Task counts
    expect(result.taskCounts.total).toBe(4);
    expect(result.taskCounts.closed).toBe(1);  // A = done
    expect(result.taskCounts.active).toBe(1);  // B = in-progress
    expect(result.taskCounts.open).toBe(2);    // C, D = todo

    // Complexity
    expect(result.complexity.low).toBe(2);    // A=2, D=3
    expect(result.complexity.medium).toBe(1); // B=5
    expect(result.complexity.high).toBe(1);   // C=8
    expect(result.complexity.average).toBe(4.5); // (2+5+8+3)/4 = 4.5

    // Skill coverage (sorted by count desc)
    expect(result.skillCoverage[0]).toEqual({ skill: 'backend', count: 3 });
    expect(result.skillCoverage[1]).toEqual({ skill: 'frontend', count: 2 });
    expect(result.skillCoverage[2]).toEqual({ skill: 'database', count: 1 });

    // Readiness (only non-closed tasks)
    expect(result.readiness.ready).toBe(1);   // B
    expect(result.readiness.blocked).toBe(1); // C
    expect(result.readiness.pending).toBe(1); // D

    // Blocked alerts
    expect(result.blockedAlerts).toHaveLength(1);
    expect(result.blockedAlerts[0].id).toBe('C');
    expect(result.blockedAlerts[0].waitingOn).toEqual(['B']);

    // Progress
    expect(result.progressPercentage).toBe(25); // 1/4 = 25%
  });

  it('includes children in all computations', () => {
    const parent = makeTask({
      id: 'P',
      status: 'in-progress',
      complexity: 6,
      requiredSkills: ['devops'],
      readiness: 'ready',
      children: [
        makeTask({
          id: 'P.1',
          status: 'done',
          complexity: 2,
          requiredSkills: ['devops'],
        }),
        makeTask({
          id: 'P.2',
          status: 'todo',
          complexity: 4,
          requiredSkills: ['testing'],
          readiness: 'pending',
        }),
      ],
    });

    const result = aggregateSummary([parent], STATES);
    expect(result.taskCounts.total).toBe(3);
    expect(result.taskCounts.closed).toBe(1);  // P.1
    expect(result.taskCounts.active).toBe(1);  // P
    expect(result.taskCounts.open).toBe(1);    // P.2
    expect(result.skillCoverage).toContainEqual({ skill: 'devops', count: 2 });
    expect(result.skillCoverage).toContainEqual({ skill: 'testing', count: 1 });
  });

  it('generates a valid ISO timestamp', () => {
    const result = aggregateSummary([], STATES);
    expect(() => new Date(result.generatedAt)).not.toThrow();
    expect(new Date(result.generatedAt).toISOString()).toBe(result.generatedAt);
  });
});
