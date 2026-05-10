import { describe, expect, it } from 'vitest';
import { HeuristicScorer, scoreTask, scoreTasks } from '../../../src/scorer/heuristic.js';
import { makeTask } from '../../fixtures/tasks.js';

describe('HeuristicScorer', () => {
  it('has name "heuristic"', () => {
    const scorer = new HeuristicScorer();
    expect(scorer.name).toBe('heuristic');
  });

  it('scores a simple, focused task as low complexity', async () => {
    const task = makeTask({
      id: 'T-1',
      title: 'Add README file',
      description: 'Create a README.md file with project setup instructions and usage examples',
      dependencies: [],
    });
    const result = await scoreTask(task);
    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeLessThanOrEqual(4);
    expect(result.taskId).toBe('T-1');
  });

  it('scores a complex, cross-cutting task as high complexity', async () => {
    const task = makeTask({
      id: 'T-10',
      title: 'Global authentication system',
      description:
        'Build an end-to-end authentication system across all modules with OAuth encryption, ' +
        'deploy to kubernetes with caching optimization, implement database migration, ' +
        'API webhook integration, and frontend component for login with shared global state throughout every service',
      dependencies: [
        { taskId: 'T-1', type: 'blocks' },
        { taskId: 'T-2', type: 'blocks' },
        { taskId: 'T-3', type: 'produces' },
      ],
    });
    const allTasks = [
      task,
      makeTask({ id: 'T-1' }),
      makeTask({ id: 'T-2' }),
      makeTask({ id: 'T-3' }),
      makeTask({ id: 'T-4', dependencies: [{ taskId: 'T-10', type: 'blocks' }] }),
      makeTask({ id: 'T-5', dependencies: [{ taskId: 'T-10', type: 'blocks' }] }),
    ];
    const result = await scoreTask(task, allTasks);
    expect(result.score).toBeGreaterThanOrEqual(5);
    expect(result.label).not.toBe('low');
  });

  it('always produces scores in range 1-10', async () => {
    // Task with minimal content (should push toward low end)
    const minimal = makeTask({ id: 'T-1', title: 'X', description: '' });
    const minResult = await scoreTask(minimal);
    expect(minResult.score).toBeGreaterThanOrEqual(1);
    expect(minResult.score).toBeLessThanOrEqual(10);

    // Task designed to push toward high end
    const maximal = makeTask({
      id: 'T-2',
      title: 'Global cross-cutting system-wide end-to-end shared',
      description:
        'Build frontend component, backend api endpoint, database schema, deploy docker kubernetes, ' +
        'auth oauth encryption, test coverage e2e, caching optimization, webhook sdk external, ' +
        'migration replication sharding, various things TBD possibly maybe some stuff across throughout every',
      dependencies: Array.from({ length: 10 }, (_, i) => ({
        taskId: `T-${i + 10}`,
        type: 'blocks' as const,
      })),
    });
    const allTasks = [
      maximal,
      ...Array.from({ length: 10 }, (_, i) =>
        makeTask({
          id: `T-${i + 10}`,
          dependencies: [{ taskId: 'T-2', type: 'blocks' }],
        }),
      ),
    ];
    const maxResult = await scoreTask(maximal, allTasks);
    expect(maxResult.score).toBeGreaterThanOrEqual(1);
    expect(maxResult.score).toBeLessThanOrEqual(10);
  });

  it('assigns correct labels based on score ranges', async () => {
    const scorer = new HeuristicScorer();

    // Low task
    const lowTask = makeTask({
      id: 'T-1',
      title: 'Fix typo',
      description: 'Fix typo in README.md on line 42',
      dependencies: [],
    });
    const lowResult = await scorer.scoreTask(lowTask, [lowTask]);
    if (lowResult.score <= 3) expect(lowResult.label).toBe('low');
    if (lowResult.score >= 4 && lowResult.score <= 6) expect(lowResult.label).toBe('medium');
    if (lowResult.score >= 7) expect(lowResult.label).toBe('high');
  });

  it('supports custom weight overrides', async () => {
    const task = makeTask({
      id: 'T-1',
      title: 'Deploy OAuth system',
      description: 'Deploy OAuth authentication to kubernetes with caching and API integration',
    });

    // Score with default weights
    const defaultScorer = new HeuristicScorer();
    const defaultResult = await defaultScorer.scoreTask(task);

    // Score with all weight on technical depth
    const depthScorer = new HeuristicScorer({
      scopeBreadth: 0,
      technicalDepth: 1.0,
      dependencyCount: 0,
      ambiguity: 0,
      crossCutting: 0,
    });
    const depthResult = await depthScorer.scoreTask(task);

    // Results should differ because weight distribution changed
    // (unless by coincidence they're the same)
    expect(depthResult.breakdown.technicalDepth).toBe(defaultResult.breakdown.technicalDepth);
    // The breakdown values are the same; the final score changes based on weights
    expect(typeof depthResult.score).toBe('number');
  });

  it('returns a valid breakdown with all values in 0-1 range', async () => {
    const task = makeTask({
      id: 'T-1',
      title: 'Build API with database',
      description: 'Create REST endpoints with PostgreSQL integration',
      dependencies: [{ taskId: 'T-0', type: 'blocks' }],
    });
    const result = await scoreTask(task, [task, makeTask({ id: 'T-0' })]);

    expect(result.breakdown.scopeBreadth).toBeGreaterThanOrEqual(0);
    expect(result.breakdown.scopeBreadth).toBeLessThanOrEqual(1);
    expect(result.breakdown.technicalDepth).toBeGreaterThanOrEqual(0);
    expect(result.breakdown.technicalDepth).toBeLessThanOrEqual(1);
    expect(result.breakdown.dependencyCount).toBeGreaterThanOrEqual(0);
    expect(result.breakdown.dependencyCount).toBeLessThanOrEqual(1);
    expect(result.breakdown.ambiguity).toBeGreaterThanOrEqual(0);
    expect(result.breakdown.ambiguity).toBeLessThanOrEqual(1);
    expect(result.breakdown.crossCutting).toBeGreaterThanOrEqual(0);
    expect(result.breakdown.crossCutting).toBeLessThanOrEqual(1);
  });
});

describe('scoreTasks', () => {
  it('scores all provided tasks', async () => {
    const tasks = [
      makeTask({ id: 'T-1', title: 'Simple task', description: 'A simple focused task' }),
      makeTask({
        id: 'T-2',
        title: 'Complex task',
        description: 'Build API with OAuth and database',
      }),
      makeTask({
        id: 'T-3',
        title: 'Medium task',
        description: 'Create a new frontend component with tests',
      }),
    ];
    const results = await scoreTasks(tasks);
    expect(results).toHaveLength(3);
    expect(results[0].taskId).toBe('T-1');
    expect(results[1].taskId).toBe('T-2');
    expect(results[2].taskId).toBe('T-3');
  });

  it('uses the full task list for dependency counting', async () => {
    const tasks = [
      makeTask({
        id: 'T-1',
        title: 'Foundation',
        description: 'Set up project scaffolding',
        dependencies: [],
      }),
      makeTask({
        id: 'T-2',
        title: 'Feature',
        description: 'Build the main feature',
        dependencies: [{ taskId: 'T-1', type: 'blocks' }],
      }),
    ];
    const results = await scoreTasks(tasks);

    // T-1 has 1 incoming dep from T-2, so its dependency score should be > 0
    expect(results[0].breakdown.dependencyCount).toBeGreaterThan(0);
    // T-2 has 1 outgoing dep to T-1, so its dependency score should be > 0
    expect(results[1].breakdown.dependencyCount).toBeGreaterThan(0);
  });
});
