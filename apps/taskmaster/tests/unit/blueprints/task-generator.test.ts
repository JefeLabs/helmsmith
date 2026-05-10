import { describe, expect, it } from 'vitest';
import { generateConcernTasks } from '../../../src/blueprints/task-generator.js';
import type { BlueprintConcern } from '../../../src/blueprints/types.js';

function makeConcern(overrides: Partial<BlueprintConcern> & { id: string }): BlueprintConcern {
  return {
    title: `Concern ${overrides.id}`,
    description: `Description for ${overrides.id}`,
    category: 'general',
    urgency: 'upfront',
    implementationGuidance: `Guidance for ${overrides.id}`,
    requiredSkills: [],
    tags: [],
    estimatedComplexity: 5,
    ...overrides,
  };
}

const upfrontConcern = makeConcern({
  id: 'c-upfront',
  urgency: 'upfront',
  category: 'security',
  estimatedComplexity: 7,
});
const patternConcern = makeConcern({
  id: 'c-pattern',
  urgency: 'pattern-first',
  category: 'performance',
  estimatedComplexity: 4,
});
const deferredConcern = makeConcern({
  id: 'c-deferred',
  urgency: 'deferred',
  category: 'documentation',
  estimatedComplexity: 3,
});
const allConcerns = [upfrontConcern, patternConcern, deferredConcern];

describe('generateConcernTasks - grouped style', () => {
  it('creates parent tasks per non-empty urgency tier', () => {
    const tasks = generateConcernTasks(allConcerns, { blueprintId: 'test-bp', style: 'grouped' });
    // 3 tiers with concerns -> 3 parent tasks
    expect(tasks).toHaveLength(3);
    expect(tasks[0].type).toBe('task');
    expect(tasks[1].type).toBe('task');
    expect(tasks[2].type).toBe('task');
  });

  it('parent tasks have correct tags: blueprint:id and urgency:tier', () => {
    const tasks = generateConcernTasks(allConcerns, { blueprintId: 'test-bp', style: 'grouped' });
    // First parent is upfront tier
    expect(tasks[0].tags).toContain('blueprint:test-bp');
    expect(tasks[0].tags).toContain('urgency:upfront');
    // Second parent is pattern-first tier
    expect(tasks[1].tags).toContain('blueprint:test-bp');
    expect(tasks[1].tags).toContain('urgency:pattern-first');
    // Third parent is deferred tier
    expect(tasks[2].tags).toContain('blueprint:test-bp');
    expect(tasks[2].tags).toContain('urgency:deferred');
  });

  it('child tasks have tags: blueprint:id, urgency:tier, concern:category', () => {
    const tasks = generateConcernTasks(allConcerns, { blueprintId: 'test-bp', style: 'grouped' });
    const upfrontChild = tasks[0].children[0];
    expect(upfrontChild.tags).toContain('blueprint:test-bp');
    expect(upfrontChild.tags).toContain('urgency:upfront');
    expect(upfrontChild.tags).toContain('concern:security');

    const patternChild = tasks[1].children[0];
    expect(patternChild.tags).toContain('concern:performance');

    const deferredChild = tasks[2].children[0];
    expect(deferredChild.tags).toContain('concern:documentation');
  });

  it('dependencies wire between tier parent tasks (upfront -> pattern-first -> deferred)', () => {
    const tasks = generateConcernTasks(allConcerns, { blueprintId: 'test-bp', style: 'grouped' });
    // First tier has no dependencies
    expect(tasks[0].dependencies).toEqual([]);
    // Second tier depends on first
    expect(tasks[1].dependencies).toHaveLength(1);
    expect(tasks[1].dependencies[0].taskId).toBe(tasks[0].id);
    expect(tasks[1].dependencies[0].type).toBe('blocks');
    // Third tier depends on second
    expect(tasks[2].dependencies).toHaveLength(1);
    expect(tasks[2].dependencies[0].taskId).toBe(tasks[1].id);
    expect(tasks[2].dependencies[0].type).toBe('blocks');
  });

  it('metadata.source is "blueprint" on all generated tasks', () => {
    const tasks = generateConcernTasks(allConcerns, { blueprintId: 'test-bp', style: 'grouped' });
    for (const parent of tasks) {
      expect(parent.metadata.source).toBe('blueprint');
      for (const child of parent.children) {
        expect(child.metadata.source).toBe('blueprint');
      }
    }
  });

  it('child task type is "subtask", parent type is "task"', () => {
    const tasks = generateConcernTasks(allConcerns, { blueprintId: 'test-bp', style: 'grouped' });
    for (const parent of tasks) {
      expect(parent.type).toBe('task');
      for (const child of parent.children) {
        expect(child.type).toBe('subtask');
      }
    }
  });

  it('skips tiers with no concerns', () => {
    // Only upfront and deferred, no pattern-first
    const tasks = generateConcernTasks([upfrontConcern, deferredConcern], {
      blueprintId: 'test-bp',
      style: 'grouped',
    });
    expect(tasks).toHaveLength(2);
    expect(tasks[0].tags).toContain('urgency:upfront');
    expect(tasks[1].tags).toContain('urgency:deferred');
    // Deferred depends on upfront since pattern-first is skipped
    expect(tasks[1].dependencies[0].taskId).toBe(tasks[0].id);
  });
});

describe('generateConcernTasks - flat style', () => {
  it('generates top-level tasks without parent grouping', () => {
    const tasks = generateConcernTasks(allConcerns, { blueprintId: 'test-bp', style: 'flat' });
    expect(tasks).toHaveLength(3);
    // Flat tasks are all subtask type (concernToTaskNode)
    for (const task of tasks) {
      expect(task.type).toBe('subtask');
      expect(task.children).toEqual([]);
    }
  });

  it('flat tasks have correct blueprint and urgency tags', () => {
    const tasks = generateConcernTasks(allConcerns, { blueprintId: 'test-bp', style: 'flat' });
    expect(tasks[0].tags).toContain('blueprint:test-bp');
    expect(tasks[0].tags).toContain('urgency:upfront');
    expect(tasks[1].tags).toContain('urgency:pattern-first');
    expect(tasks[2].tags).toContain('urgency:deferred');
  });
});

describe('generateConcernTasks - startId option', () => {
  it('offsets IDs correctly', () => {
    const tasks = generateConcernTasks(allConcerns, {
      blueprintId: 'test-bp',
      style: 'grouped',
      startId: 10,
    });
    expect(tasks[0].id).toBe('10');
    expect(tasks[1].id).toBe('11');
    expect(tasks[2].id).toBe('12');
  });

  it('offsets IDs in flat mode', () => {
    const tasks = generateConcernTasks(allConcerns, {
      blueprintId: 'test-bp',
      style: 'flat',
      startId: 100,
    });
    expect(tasks[0].id).toBe('100');
    expect(tasks[1].id).toBe('101');
    expect(tasks[2].id).toBe('102');
  });
});

describe('generateConcernTasks - empty concerns', () => {
  it('returns empty task array for empty concern list', () => {
    const tasks = generateConcernTasks([], { blueprintId: 'test-bp', style: 'grouped' });
    expect(tasks).toEqual([]);
  });

  it('returns empty task array for flat style with empty concerns', () => {
    const tasks = generateConcernTasks([], { blueprintId: 'test-bp', style: 'flat' });
    expect(tasks).toEqual([]);
  });
});
