import { describe, it, expect } from 'vitest';
import { makeTask } from '../../fixtures/tasks.js';
import { scoreTasks } from '../../../src/scorer/index.js';
import type { TaskNode } from '../../../src/config/schema.js';

describe('Scorer integration', () => {
  it('scores a realistic set of tasks with reasonable relative ordering', async () => {
    const tasks: TaskNode[] = [
      makeTask({
        id: 'T-1',
        title: 'Add README',
        description: 'Create a README.md with project setup instructions',
        dependencies: [],
      }),
      makeTask({
        id: 'T-2',
        title: 'Build REST API with database integration',
        description:
          'Implement CRUD endpoints for user management with PostgreSQL database, ' +
          'schema migrations, and input validation middleware',
        dependencies: [{ taskId: 'T-1', type: 'blocks' }],
      }),
      makeTask({
        id: 'T-3',
        title: 'End-to-end authentication across all modules',
        description:
          'Build a system-wide OAuth authentication flow shared across frontend and backend services ' +
          'with token encryption, RBAC, deploy to kubernetes with caching optimization, ' +
          'and external API webhook integration for multiple teams',
        dependencies: [
          { taskId: 'T-1', type: 'blocks' },
          { taskId: 'T-2', type: 'blocks' },
        ],
      }),
    ];

    const results = await scoreTasks(tasks);

    expect(results).toHaveLength(3);

    // T-1 (simple README) should be lowest
    // T-3 (complex cross-cutting auth) should be highest
    expect(results[0].score).toBeLessThanOrEqual(results[1].score);
    expect(results[1].score).toBeLessThanOrEqual(results[2].score);

    // T-1 should be low complexity
    expect(results[0].label).toBe('low');

    // T-3 should be medium or high
    expect(['medium', 'high']).toContain(results[2].label);
  });

  it('all ScoredResult values are valid', async () => {
    const tasks: TaskNode[] = [
      makeTask({
        id: 'T-1',
        title: 'Task one',
        description: 'Build API endpoint with database and test coverage',
        dependencies: [],
      }),
      makeTask({
        id: 'T-2',
        title: 'Task two',
        description: '',
        dependencies: [{ taskId: 'T-1', type: 'blocks' }],
      }),
    ];

    const results = await scoreTasks(tasks);

    for (const result of results) {
      // Score in range
      expect(result.score).toBeGreaterThanOrEqual(1);
      expect(result.score).toBeLessThanOrEqual(10);
      expect(Number.isInteger(result.score)).toBe(true);

      // Label matches score
      if (result.score <= 3) expect(result.label).toBe('low');
      else if (result.score <= 6) expect(result.label).toBe('medium');
      else expect(result.label).toBe('high');

      // Breakdown values in range
      for (const key of Object.keys(result.breakdown) as Array<keyof typeof result.breakdown>) {
        expect(result.breakdown[key]).toBeGreaterThanOrEqual(0);
        expect(result.breakdown[key]).toBeLessThanOrEqual(1);
      }

      // taskId is set
      expect(result.taskId).toBeTruthy();
    }
  });

  it('empty description tasks score higher on ambiguity', async () => {
    const tasks: TaskNode[] = [
      makeTask({
        id: 'T-1',
        title: 'Implement feature',
        description: '',
        dependencies: [],
      }),
      makeTask({
        id: 'T-2',
        title: 'Implement feature',
        description:
          'Create the user registration module in src/auth/register.ts with email validation, ' +
          'bcrypt password hashing, and 5 unit tests covering edge cases',
        dependencies: [],
      }),
    ];

    const results = await scoreTasks(tasks);

    // T-1 (empty description) should have higher ambiguity
    expect(results[0].breakdown.ambiguity).toBeGreaterThan(results[1].breakdown.ambiguity);
  });

  it('highly connected tasks score higher on dependency count', async () => {
    const isolated = makeTask({
      id: 'T-1',
      title: 'Isolated task',
      description: 'A standalone task with no connections',
      dependencies: [],
    });
    const connected = makeTask({
      id: 'T-2',
      title: 'Connected task',
      description: 'A task with many connections',
      dependencies: [
        { taskId: 'T-1', type: 'blocks' },
        { taskId: 'T-3', type: 'blocks' },
        { taskId: 'T-4', type: 'produces' },
      ],
    });
    const allTasks = [
      isolated,
      connected,
      makeTask({ id: 'T-3' }),
      makeTask({ id: 'T-4' }),
      makeTask({ id: 'T-5', dependencies: [{ taskId: 'T-2', type: 'blocks' }] }),
    ];

    const results = await scoreTasks([isolated, connected], allTasks);

    expect(results[1].breakdown.dependencyCount).toBeGreaterThan(
      results[0].breakdown.dependencyCount,
    );
  });

  it('exports types and functions from index barrel', async () => {
    // Verify that the index barrel re-exports everything needed
    const mod = await import('../../../src/scorer/index.js');
    expect(typeof mod.HeuristicScorer).toBe('function');
    expect(typeof mod.scoreTask).toBe('function');
    expect(typeof mod.scoreTasks).toBe('function');
    expect(typeof mod.analyzeScopeBreadth).toBe('function');
    expect(typeof mod.analyzeTechnicalDepth).toBe('function');
    expect(typeof mod.analyzeDependencyCount).toBe('function');
    expect(typeof mod.analyzeAmbiguity).toBe('function');
    expect(typeof mod.analyzeCrossCutting).toBe('function');
    expect(mod.DEFAULT_WEIGHTS).toBeDefined();
    expect(mod.DEFAULT_WEIGHTS.scopeBreadth).toBe(0.20);
    expect(mod.DEFAULT_WEIGHTS.technicalDepth).toBe(0.25);
    expect(mod.DEFAULT_WEIGHTS.dependencyCount).toBe(0.15);
    expect(mod.DEFAULT_WEIGHTS.ambiguity).toBe(0.20);
    expect(mod.DEFAULT_WEIGHTS.crossCutting).toBe(0.20);
  });
});
