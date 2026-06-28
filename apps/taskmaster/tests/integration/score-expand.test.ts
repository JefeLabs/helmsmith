import { describe, expect, it } from 'vitest';
import type { TaskNode } from '../../src/config/schema.js';
import { expandTask, getChildType } from '../../src/decomposer/index.js';
import { HeuristicScorer } from '../../src/scorer/index.js';

function makeTask(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: '1',
    title: 'Test task',
    description: 'A moderately complex task involving multiple components and integrations',
    type: 'task',
    status: 'todo',
    complexity: 1,
    priority: 'medium',
    requiredSkills: ['backend', 'frontend'],
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

describe('Score -> Expand pipeline', () => {
  it('scores a task and expands it when complexity is high', async () => {
    const task = makeTask({
      id: 'T-1',
      title: 'Build authentication system',
      description:
        'Implement OAuth 2.0 with Google and GitHub. JWT token management. Session handling with Redis. Rate limiting and brute force protection.',
      requiredSkills: ['backend', 'security', 'database'],
    });

    // Step 1: Score
    const scorer = new HeuristicScorer();
    const scoreResult = await scorer.scoreTask(task, [task]);
    task.complexity = scoreResult.score;

    expect(scoreResult.score).toBeGreaterThanOrEqual(1);
    expect(scoreResult.score).toBeLessThanOrEqual(10);

    // Step 2: Expand (heuristic only)
    const expandResult = await expandTask(task, 'task-only', {
      authAvailable: false,
      statesConfig: { preset: 'standard', enforce_transitions: false },
    });

    // Should succeed (not an error)
    expect('children' in expandResult).toBe(true);
    if ('children' in expandResult) {
      expect(expandResult.children.length).toBeGreaterThan(0);
      expect(expandResult.parentId).toBe('T-1');

      // Verify child IDs follow parent.N pattern
      for (let i = 0; i < expandResult.children.length; i++) {
        expect(expandResult.children[i].id).toBe(`T-1.${i + 1}`);
      }

      // Verify child type is correct for task-only style
      const childType = getChildType('task', 'task-only');
      for (const child of expandResult.children) {
        expect(child.type).toBe(childType);
      }
    }
  });

  it('expanded children have valid default status', async () => {
    const task = makeTask({
      id: 'T-2',
      title: 'Design API layer',
      description:
        'Create CRUD endpoints for core resources. Build middleware pipeline. Request validation.',
    });
    task.complexity = 7;

    const result = await expandTask(task, 'task-only', {
      authAvailable: false,
      statesConfig: { preset: 'standard', enforce_transitions: false },
    });

    expect('children' in result).toBe(true);
    if ('children' in result) {
      for (const child of result.children) {
        // Children should have the default status from the standard preset
        expect(child.status).toBeTruthy();
        expect(child.complexity).toBeGreaterThanOrEqual(1);
        expect(child.children).toEqual([]);
      }
    }
  });

  it('refuses to expand a task at max depth', async () => {
    const task = makeTask({
      id: 'T-3',
      title: 'A subtask',
      type: 'subtask',
    });
    task.complexity = 8;

    const result = await expandTask(task, 'task-only', {
      authAvailable: false,
      statesConfig: { preset: 'standard', enforce_transitions: false },
    });

    // Should be an error (subtask cannot be expanded further in task-only)
    expect('reason' in result).toBe(true);
  });

  it('respects maxSubtasks option', async () => {
    const task = makeTask({
      id: 'T-4',
      title: 'Complex system design',
      description: 'A very complex task with many facets and integration points.',
    });
    task.complexity = 9;

    const result = await expandTask(task, 'task-only', {
      authAvailable: false,
      statesConfig: { preset: 'standard', enforce_transitions: false },
      maxSubtasks: 3,
    });

    expect('children' in result).toBe(true);
    if ('children' in result) {
      expect(result.children.length).toBeLessThanOrEqual(3);
    }
  });

  it('dry-run returns estimate without generating children', async () => {
    const task = makeTask({
      id: 'T-5',
      title: 'Another task',
      description: 'Some description',
    });
    task.complexity = 7;

    const result = await expandTask(task, 'task-only', {
      authAvailable: false,
      statesConfig: { preset: 'standard', enforce_transitions: false },
      dryRun: true,
    });

    expect('children' in result).toBe(true);
    if ('children' in result) {
      expect(result.dryRun).toBe(true);
      expect(result.children).toEqual([]);
      expect(result.estimatedCount).toBeGreaterThan(0);
    }
  });
});
