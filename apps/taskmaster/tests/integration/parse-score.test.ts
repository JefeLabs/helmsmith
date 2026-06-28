import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePlan } from '../../src/parser/index.js';
import { HeuristicScorer } from '../../src/scorer/index.js';

const FIXTURE_PLAN = resolve(import.meta.dirname, '../fixtures/sample-plan.md');

describe('Parse -> Score pipeline', () => {
  it('parses a markdown plan and scores all tasks', async () => {
    const content = await readFile(FIXTURE_PLAN, 'utf-8');

    // Step 1: Parse
    const result = await parsePlan(content, 'sample-plan.md', {
      style: 'task-only',
      defaultStatus: 'backlog',
    });

    expect(result.tasks.length).toBeGreaterThan(0);
    expect(result.metadata.format).toBe('markdown');
    expect(result.metadata.tasksGenerated).toBe(result.tasks.length);

    // Step 2: Score each task
    const scorer = new HeuristicScorer();
    const scores = await Promise.all(
      result.tasks.map((task) => scorer.scoreTask(task, result.tasks)),
    );

    // All scores must be valid
    for (const scored of scores) {
      expect(scored.score).toBeGreaterThanOrEqual(1);
      expect(scored.score).toBeLessThanOrEqual(10);
      expect(['low', 'medium', 'high']).toContain(scored.label);
      expect(scored.taskId).toBeTruthy();

      // Breakdown dimensions should be 0-1 range
      expect(scored.breakdown.scopeBreadth).toBeGreaterThanOrEqual(0);
      expect(scored.breakdown.scopeBreadth).toBeLessThanOrEqual(1);
      expect(scored.breakdown.technicalDepth).toBeGreaterThanOrEqual(0);
      expect(scored.breakdown.technicalDepth).toBeLessThanOrEqual(1);
    }
  });

  it('returns consistent labels for score ranges', async () => {
    const content = await readFile(FIXTURE_PLAN, 'utf-8');
    const result = await parsePlan(content, 'sample-plan.md', {
      style: 'task-only',
      defaultStatus: 'backlog',
    });

    const scorer = new HeuristicScorer();
    const scores = await Promise.all(
      result.tasks.map((task) => scorer.scoreTask(task, result.tasks)),
    );

    for (const scored of scores) {
      if (scored.score <= 3) expect(scored.label).toBe('low');
      else if (scored.score <= 6) expect(scored.label).toBe('medium');
      else expect(scored.label).toBe('high');
    }
  });

  it('assigns default status from options to parsed tasks', async () => {
    const content = await readFile(FIXTURE_PLAN, 'utf-8');
    const result = await parsePlan(content, 'sample-plan.md', {
      style: 'task-only',
      defaultStatus: 'backlog',
    });

    for (const task of result.tasks) {
      expect(task.status).toBe('backlog');
    }
  });

  it('applies task-only style (all tasks have type "task")', async () => {
    const content = await readFile(FIXTURE_PLAN, 'utf-8');
    const result = await parsePlan(content, 'sample-plan.md', {
      style: 'task-only',
      defaultStatus: 'backlog',
    });

    for (const task of result.tasks) {
      expect(task.type).toBe('task');
    }
  });

  it('parses text format and scores successfully', async () => {
    const textFixture = resolve(import.meta.dirname, '../fixtures/sample-plan.txt');
    const content = await readFile(textFixture, 'utf-8');

    const result = await parsePlan(content, 'plan.txt', {
      style: 'task-only',
      defaultStatus: 'todo',
    });

    expect(result.tasks.length).toBeGreaterThan(0);
    expect(result.metadata.format).toBe('text');

    const scorer = new HeuristicScorer();
    const scores = await Promise.all(
      result.tasks.map((task) => scorer.scoreTask(task, result.tasks)),
    );

    for (const scored of scores) {
      expect(scored.score).toBeGreaterThanOrEqual(1);
      expect(scored.score).toBeLessThanOrEqual(10);
    }
  });

  it('parses YAML format and scores successfully', async () => {
    const yamlFixture = resolve(import.meta.dirname, '../fixtures/sample-plan.yaml');
    const content = await readFile(yamlFixture, 'utf-8');

    const result = await parsePlan(content, 'plan.yaml', {
      style: 'task-only',
      defaultStatus: 'todo',
    });

    expect(result.tasks.length).toBeGreaterThan(0);
    expect(result.metadata.format).toBe('yaml');

    const scorer = new HeuristicScorer();
    const scores = await Promise.all(
      result.tasks.map((task) => scorer.scoreTask(task, result.tasks)),
    );

    for (const scored of scores) {
      expect(scored.score).toBeGreaterThanOrEqual(1);
      expect(scored.score).toBeLessThanOrEqual(10);
    }
  });
});
