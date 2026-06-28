import { describe, expect, it } from 'vitest';
import {
  ProjectConfigSchema,
  StatesConfigSchema,
  TaskNodeSchema,
  TasksFileSchema,
} from '../src/config/schema.js';

describe('TaskNode schema', () => {
  it('validates a minimal task', () => {
    const result = TaskNodeSchema.safeParse({
      id: 'T-1',
      title: 'Setup project',
      type: 'task',
    });
    expect(result.success).toBe(true);
  });

  it('validates a full task with all fields', () => {
    const result = TaskNodeSchema.safeParse({
      id: 'E-1',
      title: 'Epic: API Layer',
      description: 'Build the REST API',
      type: 'epic',
      status: 'in-progress',
      complexity: 7,
      priority: 'high',
      requiredSkills: ['backend', 'database'],
      dependencies: [{ taskId: 'T-0', type: 'blocks' }],
      readiness: 'blocked',
      assignee: 'agent-1',
      outputs: ['api-schema'],
      tags: ['backend'],
      children: [
        {
          id: 'S-1.1',
          title: 'Story: Auth endpoints',
          type: 'story',
          children: [],
        },
      ],
      metadata: {
        source: 'plan.md:L42',
        autoExpanded: false,
        skillsInferred: true,
        depsInferred: true,
        createdAt: '2026-02-11T00:00:00Z',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid type', () => {
    const result = TaskNodeSchema.safeParse({
      id: 'T-1',
      title: 'Bad type',
      type: 'feature',
    });
    expect(result.success).toBe(false);
  });

  it('rejects complexity out of range', () => {
    const result = TaskNodeSchema.safeParse({
      id: 'T-1',
      title: 'Bad score',
      type: 'task',
      complexity: 15,
    });
    expect(result.success).toBe(false);
  });
});

describe('TasksFile schema', () => {
  it('validates an empty array', () => {
    const result = TasksFileSchema.safeParse([]);
    expect(result.success).toBe(true);
  });

  it('validates an array of tasks', () => {
    const result = TasksFileSchema.safeParse([
      { id: 'T-1', title: 'Task 1', type: 'task' },
      { id: 'T-2', title: 'Task 2', type: 'task' },
    ]);
    expect(result.success).toBe(true);
  });
});

describe('ProjectConfig schema', () => {
  it('validates with defaults', () => {
    const result = ProjectConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.style).toBe('task-only');
    }
  });

  it('applies nested defaults when sub-objects provided', () => {
    const result = ProjectConfigSchema.safeParse({
      states: {},
      skills: {},
      ai: {},
      thresholds: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.states.preset).toBe('standard');
      expect(result.data.states.enforce_transitions).toBe(false);
      expect(result.data.skills.auto_infer).toBe(true);
      expect(result.data.skills.vocabulary).toEqual([]);
      expect(result.data.ai.model).toBe('claude-sonnet-4-20250514');
      expect(result.data.thresholds.expand).toBe(5);
      expect(result.data.thresholds.flag).toBe(8);
    }
  });

  it('applies threshold defaults when thresholds provided explicitly', () => {
    const result = ProjectConfigSchema.safeParse({
      thresholds: { expand: 5, flag: 8 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.thresholds.expand).toBe(5);
      expect(result.data.thresholds.flag).toBe(8);
    }
  });

  it('validates a full config', () => {
    const result = ProjectConfigSchema.safeParse({
      style: 'agile-full',
      states: { preset: 'kanban', enforce_transitions: true },
      skills: { vocabulary: ['backend', 'frontend'], auto_infer: false },
      ai: { model: 'gpt-4o' },
      thresholds: { expand: 3, flag: 7 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid style', () => {
    const result = ProjectConfigSchema.safeParse({ style: 'waterfall' });
    expect(result.success).toBe(false);
  });
});

describe('StatesConfig schema', () => {
  it('validates with preset', () => {
    const result = StatesConfigSchema.safeParse({ preset: 'simple' });
    expect(result.success).toBe(true);
  });

  it('validates custom states', () => {
    const result = StatesConfigSchema.safeParse({
      preset: 'custom',
      custom: [
        { name: 'draft', category: 'open' },
        { name: 'in-dev', category: 'active', transitions: ['done'] },
        { name: 'done', category: 'closed' },
      ],
      enforce_transitions: true,
    });
    expect(result.success).toBe(true);
  });
});
