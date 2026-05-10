import { describe, expect, it } from 'vitest';
import type { TaskNode } from '../../../src/config/schema.js';
import { findClosestMatch, validateSkills } from '../../../src/skills/validation.js';

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

// --- findClosestMatch ---

describe('findClosestMatch', () => {
  const vocabulary = ['backend', 'frontend', 'database', 'api-design', 'ui-ux', 'devops'];

  it('finds prefix match (input is prefix of vocab skill)', () => {
    expect(findClosestMatch('back', vocabulary)).toBe('backend');
  });

  it('finds prefix match (input is prefix of vocab skill, case-insensitive)', () => {
    expect(findClosestMatch('Front', vocabulary)).toBe('frontend');
  });

  it('finds reverse prefix match (vocab skill is prefix of input)', () => {
    expect(findClosestMatch('databases', vocabulary)).toBe('database');
  });

  it('finds substring match', () => {
    expect(findClosestMatch('base', vocabulary)).toBe('database');
  });

  it('returns null when no match found', () => {
    expect(findClosestMatch('graphql', vocabulary)).toBeNull();
  });

  it('returns null for empty vocabulary', () => {
    expect(findClosestMatch('backend', [])).toBeNull();
  });

  it('returns exact match (prefix match covers it)', () => {
    expect(findClosestMatch('backend', vocabulary)).toBe('backend');
  });

  it('handles hyphenated skills', () => {
    expect(findClosestMatch('api', vocabulary)).toBe('api-design');
  });
});

// --- validateSkills ---

describe('validateSkills', () => {
  const vocabulary = ['backend', 'frontend', 'database', 'testing', 'devops'];

  it('returns empty array when all skills are in vocabulary', () => {
    const tasks = [
      makeTask({ id: '1', requiredSkills: ['backend', 'database'] }),
      makeTask({ id: '2', requiredSkills: ['frontend'] }),
    ];
    const issues = validateSkills(tasks, vocabulary);
    expect(issues).toEqual([]);
  });

  it('reports skills not in vocabulary', () => {
    const tasks = [makeTask({ id: '1', requiredSkills: ['backend', 'graphql'] })];
    const issues = validateSkills(tasks, vocabulary);
    expect(issues).toHaveLength(1);
    expect(issues[0].taskId).toBe('1');
    expect(issues[0].skill).toBe('graphql');
  });

  it('provides closest match suggestion when available', () => {
    const tasks = [makeTask({ id: '1', requiredSkills: ['back'] })];
    const issues = validateSkills(tasks, vocabulary);
    expect(issues).toHaveLength(1);
    expect(issues[0].suggestion).toBe('backend');
  });

  it('returns null suggestion when no close match exists', () => {
    const tasks = [makeTask({ id: '1', requiredSkills: ['kubernetes'] })];
    const issues = validateSkills(tasks, vocabulary);
    expect(issues).toHaveLength(1);
    expect(issues[0].suggestion).toBeNull();
  });

  it('recursively checks children', () => {
    const child = makeTask({ id: '1.1', requiredSkills: ['unknown-skill'] });
    const parent = makeTask({ id: '1', requiredSkills: ['backend'], children: [child] });

    const issues = validateSkills([parent], vocabulary);
    expect(issues).toHaveLength(1);
    expect(issues[0].taskId).toBe('1.1');
    expect(issues[0].skill).toBe('unknown-skill');
  });

  it('handles multiple issues across multiple tasks', () => {
    const tasks = [
      makeTask({ id: '1', requiredSkills: ['backend', 'graphql'] }),
      makeTask({ id: '2', requiredSkills: ['mobile', 'frontend'] }),
    ];
    const issues = validateSkills(tasks, vocabulary);
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.skill)).toEqual(['graphql', 'mobile']);
  });

  it('handles tasks with empty requiredSkills', () => {
    const tasks = [makeTask({ id: '1', requiredSkills: [] })];
    const issues = validateSkills(tasks, vocabulary);
    expect(issues).toEqual([]);
  });

  it('handles empty task list', () => {
    const issues = validateSkills([], vocabulary);
    expect(issues).toEqual([]);
  });

  it('handles deeply nested children', () => {
    const grandchild = makeTask({ id: '1.1.1', requiredSkills: ['invalid-skill'] });
    const child = makeTask({ id: '1.1', requiredSkills: ['backend'], children: [grandchild] });
    const parent = makeTask({ id: '1', requiredSkills: ['frontend'], children: [child] });

    const issues = validateSkills([parent], vocabulary);
    expect(issues).toHaveLength(1);
    expect(issues[0].taskId).toBe('1.1.1');
  });
});
