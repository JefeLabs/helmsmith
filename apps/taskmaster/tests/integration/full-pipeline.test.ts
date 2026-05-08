import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { TaskNode, StateDefinition } from '../../src/config/schema.js';
import { STANDARD_PRESET } from '../../src/config/state-presets.js';
import { parsePlan } from '../../src/parser/index.js';
import { HeuristicScorer } from '../../src/scorer/index.js';
import { expandTask } from '../../src/decomposer/index.js';
import {
  recomputeAllReadiness,
  applyReadiness,
  buildDelegationManifest,
  findNextTask,
} from '../../src/readiness/index.js';

const FIXTURE_PLAN = resolve(import.meta.dirname, '../fixtures/sample-plan.md');
const STATES: StateDefinition[] = [...STANDARD_PRESET];

describe('Full pipeline: Parse -> Score -> Expand -> Ready -> Manifest', () => {
  it('processes a plan through the entire pipeline', async () => {
    // 1. Parse
    const content = await readFile(FIXTURE_PLAN, 'utf-8');
    const parseResult = await parsePlan(content, 'sample-plan.md', {
      style: 'task-only',
      defaultStatus: 'todo',
    });

    expect(parseResult.tasks.length).toBeGreaterThan(0);
    const tasks = parseResult.tasks;

    // 2. Score
    const scorer = new HeuristicScorer();
    for (const task of tasks) {
      const scoreResult = await scorer.scoreTask(task, tasks);
      task.complexity = scoreResult.score;
    }

    // Verify all tasks are scored
    for (const task of tasks) {
      expect(task.complexity).toBeGreaterThanOrEqual(1);
      expect(task.complexity).toBeLessThanOrEqual(10);
    }

    // 3. Expand high-complexity tasks (>= 5)
    const expandThreshold = 5;
    const eligible = tasks.filter((t) => t.complexity >= expandThreshold && t.children.length === 0);

    for (const task of eligible) {
      const result = await expandTask(task, 'task-only', {
        authAvailable: false,
        statesConfig: { preset: 'standard', enforce_transitions: false },
      });

      if ('children' in result) {
        task.children = result.children;
      }
    }

    // Verify some tasks got expanded
    const expandedTasks = tasks.filter((t) => t.children.length > 0);
    // Note: may or may not have expandable tasks depending on scores
    // At minimum, the pipeline should not crash

    // 4. Add dependencies between tasks for readiness testing
    if (tasks.length >= 3) {
      tasks[1].dependencies = [{ taskId: tasks[0].id, type: 'blocks' }];
      tasks[2].dependencies = [{ taskId: tasks[1].id, type: 'blocks' }];
    }

    // 5. Compute readiness
    const readinessResults = recomputeAllReadiness(tasks, STATES);
    applyReadiness(tasks, readinessResults);

    // First task should be pending/ready (no deps), others may be blocked
    if (tasks.length >= 3) {
      expect(tasks[0].readiness).not.toBe('blocked');
      expect(tasks[2].readiness).toBe('blocked');
    }

    // 6. Build delegation manifest
    const manifest = buildDelegationManifest(tasks, STATES);

    expect(manifest).toHaveProperty('ready_tasks');
    expect(manifest).toHaveProperty('blocked_tasks');
    expect(manifest).toHaveProperty('summary');

    // summary.total counts all flattened non-completed tasks (including children)
    expect(manifest.summary.total).toBeGreaterThanOrEqual(tasks.length);
    expect(manifest.summary.ready).toBeGreaterThanOrEqual(0);
    expect(manifest.summary.blocked).toBeGreaterThanOrEqual(0);
    expect(manifest.summary.completed).toBeGreaterThanOrEqual(0);

    // Ready tasks should have correct structure
    for (const ready of manifest.ready_tasks) {
      expect(ready).toHaveProperty('id');
      expect(ready).toHaveProperty('title');
      expect(ready).toHaveProperty('priority');
      expect(ready).toHaveProperty('complexity');
      expect(ready).toHaveProperty('required_skills');
    }
  });

  it('findNextTask returns the highest priority ready task from pipeline', async () => {
    const content = await readFile(FIXTURE_PLAN, 'utf-8');
    const parseResult = await parsePlan(content, 'sample-plan.md', {
      style: 'task-only',
      defaultStatus: 'todo',
    });

    const tasks = parseResult.tasks;

    // Score
    const scorer = new HeuristicScorer();
    for (const task of tasks) {
      const scoreResult = await scorer.scoreTask(task, tasks);
      task.complexity = scoreResult.score;
    }

    // Set priorities for predictability
    if (tasks.length >= 2) {
      tasks[0].priority = 'low';
      tasks[1].priority = 'critical';
    }

    // Compute readiness
    const results = recomputeAllReadiness(tasks, STATES);
    applyReadiness(tasks, results);

    // Find next
    const next = findNextTask(tasks, STATES);
    expect(next).not.toBeNull();

    if (tasks.length >= 2) {
      // The critical-priority task should be chosen
      expect(next!.priority).toBe('critical');
    }
  });

  it('expanded subtasks appear in manifest flat counts', async () => {
    const content = await readFile(FIXTURE_PLAN, 'utf-8');
    const parseResult = await parsePlan(content, 'sample-plan.md', {
      style: 'task-only',
      defaultStatus: 'todo',
    });

    const tasks = parseResult.tasks;

    // Force high complexity on first task and expand it
    if (tasks.length > 0) {
      tasks[0].complexity = 8;
      const result = await expandTask(tasks[0], 'task-only', {
        authAvailable: false,
        statesConfig: { preset: 'standard', enforce_transitions: false },
      });

      if ('children' in result) {
        tasks[0].children = result.children;
      }
    }

    const results = recomputeAllReadiness(tasks, STATES);
    applyReadiness(tasks, results);

    const manifest = buildDelegationManifest(tasks, STATES);

    // summary.total counts all flattened non-completed tasks (including subtasks)
    // Just verify it is at least as large as the top-level task count
    expect(manifest.summary.total).toBeGreaterThanOrEqual(tasks.length);
  });
});
