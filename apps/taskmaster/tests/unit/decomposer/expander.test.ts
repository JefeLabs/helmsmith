import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatesConfig } from '../../../src/config/schema.js';
import {
  buildExpansionPrompt,
  expandMultiple,
  expandTask,
  generateSubtaskId,
  getChildType,
  heuristicExpand,
  parseExpansionResponse,
} from '../../../src/decomposer/expander.js';
import { makeTask } from '../../fixtures/tasks.js';

// Mock callAI (replaces callCopilot)
vi.mock('../../../src/auth/call-ai.js', () => ({
  callAI: vi.fn(),
  resolveActiveAuth: vi.fn(),
}));

// Mock getDefaultStatus
vi.mock('../../../src/config/state-engine.js', () => ({
  getDefaultStatus: vi.fn(() => 'todo'),
}));

import { callAI } from '../../../src/auth/call-ai.js';

const defaultStatesConfig: StatesConfig = {
  preset: 'standard',
  enforce_transitions: false,
};

// ---- getChildType ----

describe('getChildType', () => {
  it('returns story for epic in agile-full', () => {
    expect(getChildType('epic', 'agile-full')).toBe('story');
  });

  it('returns task for story in agile-full', () => {
    expect(getChildType('story', 'agile-full')).toBe('task');
  });

  it('returns subtask for task in agile-full', () => {
    expect(getChildType('task', 'agile-full')).toBe('subtask');
  });

  it('returns null for subtask in agile-full (max depth)', () => {
    expect(getChildType('subtask', 'agile-full')).toBeNull();
  });

  it('returns subtask for task in task-only', () => {
    expect(getChildType('task', 'task-only')).toBe('subtask');
  });

  it('returns null for subtask in task-only (max depth)', () => {
    expect(getChildType('subtask', 'task-only')).toBeNull();
  });

  it('returns task for story in story-driven', () => {
    expect(getChildType('story', 'story-driven')).toBe('task');
  });

  it('returns null for task in flat style (max depth)', () => {
    expect(getChildType('task', 'flat')).toBeNull();
  });

  it('returns null for unknown style', () => {
    expect(getChildType('task', 'nonexistent')).toBeNull();
  });

  it('returns null for type not in hierarchy', () => {
    expect(getChildType('epic', 'task-only')).toBeNull();
  });
});

// ---- generateSubtaskId ----

describe('generateSubtaskId', () => {
  it('generates {parentId}.{index} format', () => {
    expect(generateSubtaskId('T-3', 1)).toBe('T-3.1');
    expect(generateSubtaskId('T-3', 2)).toBe('T-3.2');
  });

  it('works with nested parent IDs', () => {
    expect(generateSubtaskId('T-3.1', 1)).toBe('T-3.1.1');
    expect(generateSubtaskId('T-3.1', 3)).toBe('T-3.1.3');
  });

  it('handles various parent ID formats', () => {
    expect(generateSubtaskId('E-1', 1)).toBe('E-1.1');
    expect(generateSubtaskId('S-2.3', 4)).toBe('S-2.3.4');
  });
});

// ---- buildExpansionPrompt ----

describe('buildExpansionPrompt', () => {
  it('returns system and user messages', () => {
    const task = makeTask({
      id: 'T-3',
      title: 'Build auth system',
      description: 'Implement authentication with OAuth',
      requiredSkills: ['backend', 'auth'],
      dependencies: [{ taskId: 'T-1', type: 'blocks' }],
    });

    const messages = buildExpansionPrompt(task, 5, 'subtask');

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
  });

  it('includes task title and description in user message', () => {
    const task = makeTask({
      id: 'T-3',
      title: 'Build auth system',
      description: 'Implement OAuth with JWT tokens',
    });

    const messages = buildExpansionPrompt(task, 5, 'subtask');
    const userContent = messages[1].content;

    expect(userContent).toContain('Build auth system');
    expect(userContent).toContain('Implement OAuth with JWT tokens');
  });

  it('includes required skills when present', () => {
    const task = makeTask({
      requiredSkills: ['backend', 'auth'],
    });

    const messages = buildExpansionPrompt(task, 5, 'subtask');
    expect(messages[1].content).toContain('backend, auth');
  });

  it('includes max subtasks and child type', () => {
    const task = makeTask({});
    const messages = buildExpansionPrompt(task, 7, 'story');

    expect(messages[1].content).toContain('7');
    expect(messages[1].content).toContain('story');
  });

  it('mentions dependency count when task has dependencies', () => {
    const task = makeTask({
      dependencies: [
        { taskId: 'T-1', type: 'blocks' },
        { taskId: 'T-2', type: 'produces' },
      ],
    });

    const messages = buildExpansionPrompt(task, 5, 'subtask');
    expect(messages[1].content).toContain('2 dependency');
  });
});

// ---- parseExpansionResponse ----

describe('parseExpansionResponse', () => {
  it('parses a clean JSON array', () => {
    const input = '[{"title": "Setup database", "description": "Configure PostgreSQL"}]';
    const result = parseExpansionResponse(input);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Setup database');
    expect(result[0].description).toBe('Configure PostgreSQL');
  });

  it('parses JSON wrapped in markdown code fences', () => {
    const input = '```json\n[{"title": "Task A", "description": "Desc A"}]\n```';
    const result = parseExpansionResponse(input);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Task A');
  });

  it('parses JSON wrapped in plain code fences', () => {
    const input = '```\n[{"title": "Task B", "description": "Desc B"}]\n```';
    const result = parseExpansionResponse(input);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Task B');
  });

  it('extracts JSON array from surrounding text', () => {
    const input = 'Here are the subtasks:\n[{"title": "A", "description": "B"}]\nDone!';
    const result = parseExpansionResponse(input);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('A');
  });

  it('handles multiple items', () => {
    const input = JSON.stringify([
      { title: 'First', description: 'Desc 1' },
      { title: 'Second', description: 'Desc 2' },
      { title: 'Third', description: 'Desc 3' },
    ]);
    const result = parseExpansionResponse(input);

    expect(result).toHaveLength(3);
    expect(result[0].title).toBe('First');
    expect(result[2].title).toBe('Third');
  });

  it('filters out items missing title or description', () => {
    const input = JSON.stringify([
      { title: 'Valid', description: 'Has both' },
      { title: 'No desc' },
      { description: 'No title' },
      { title: 'Also valid', description: 'Yes' },
    ]);
    const result = parseExpansionResponse(input);

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('Valid');
    expect(result[1].title).toBe('Also valid');
  });

  it('ignores extra fields from AI response', () => {
    const input = JSON.stringify([
      { title: 'Task', description: 'Desc', priority: 'high', extra: true },
    ]);
    const result = parseExpansionResponse(input);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ title: 'Task', description: 'Desc' });
  });

  it('throws on non-array JSON', () => {
    expect(() => parseExpansionResponse('{"title": "not an array"}')).toThrow(
      'AI response is not a JSON array',
    );
  });

  it('throws on invalid JSON', () => {
    expect(() => parseExpansionResponse('not json at all')).toThrow();
  });

  it('returns empty array for empty JSON array', () => {
    const result = parseExpansionResponse('[]');
    expect(result).toEqual([]);
  });
});

// ---- heuristicExpand ----

describe('heuristicExpand', () => {
  it('generates "Part N of M" for empty description', () => {
    const task = makeTask({ title: 'My Task', description: '' });
    const result = heuristicExpand(task, 3);

    expect(result).toHaveLength(3);
    expect(result[0].title).toBe('Part 1 of 3: My Task');
    expect(result[2].title).toBe('Part 3 of 3: My Task');
  });

  it('splits by bullet points when present', () => {
    const task = makeTask({
      description: '- Setup database\n- Create API endpoints\n- Write tests',
    });
    const result = heuristicExpand(task, 5);

    expect(result).toHaveLength(3);
    expect(result[0].title).toBe('Setup database');
    expect(result[1].title).toBe('Create API endpoints');
    expect(result[2].title).toBe('Write tests');
  });

  it('splits by asterisk bullets', () => {
    const task = makeTask({
      description: '* First item\n* Second item\n* Third item',
    });
    const result = heuristicExpand(task, 5);

    expect(result).toHaveLength(3);
    expect(result[0].title).toBe('First item');
  });

  it('splits by paragraphs when no bullets', () => {
    const task = makeTask({
      description:
        'First paragraph about setup.\n\nSecond paragraph about config.\n\nThird paragraph about testing.',
    });
    const result = heuristicExpand(task, 5);

    expect(result).toHaveLength(3);
    expect(result[0].title).toContain('First paragraph');
    expect(result[2].title).toContain('Third paragraph');
  });

  it('splits by sentences when single paragraph', () => {
    const task = makeTask({
      description:
        'Build the login form. Implement JWT token validation. Add password reset flow. Create session management.',
    });
    const result = heuristicExpand(task, 4);

    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.length).toBeLessThanOrEqual(4);
  });

  it('limits output to maxSubtasks', () => {
    const task = makeTask({
      description: '- A\n- B\n- C\n- D\n- E\n- F\n- G',
    });
    const result = heuristicExpand(task, 3);

    expect(result).toHaveLength(3);
  });

  it('falls back to "Part N of M" for short single-line description', () => {
    const task = makeTask({
      title: 'Simple task',
      description: 'Short description',
    });
    const result = heuristicExpand(task, 3);

    expect(result).toHaveLength(3);
    expect(result[0].title).toContain('Part 1 of 3');
  });

  it('truncates long titles to 80 chars', () => {
    const longLine = 'A'.repeat(100);
    const task = makeTask({
      description: `- ${longLine}\n- Short`,
    });
    const result = heuristicExpand(task, 5);

    expect(result[0].title.length).toBeLessThanOrEqual(80);
    expect(result[0].title).toContain('...');
  });
});

// ---- expandTask ----

describe('expandTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error when task is at max depth', async () => {
    const task = makeTask({ id: 'T-1', type: 'subtask' });
    const result = await expandTask(task, 'task-only', {
      statesConfig: defaultStatesConfig,
    });

    expect('reason' in result).toBe(true);
    if ('reason' in result) {
      expect(result.reason).toContain('maximum depth');
      expect(result.reason).toContain('subtask');
    }
  });

  it('returns error when task is at max depth in flat style', async () => {
    const task = makeTask({ id: 'T-1', type: 'task' });
    const result = await expandTask(task, 'flat', {
      statesConfig: defaultStatesConfig,
    });

    expect('reason' in result).toBe(true);
    if ('reason' in result) {
      expect(result.reason).toContain('maximum depth');
    }
  });

  it('returns error when already expanded without --force', async () => {
    const task = makeTask({
      id: 'T-1',
      type: 'task',
      children: [makeTask({ id: 'T-1.1', type: 'subtask' })],
    });
    const result = await expandTask(task, 'task-only', {
      statesConfig: defaultStatesConfig,
    });

    expect('reason' in result).toBe(true);
    if ('reason' in result) {
      expect(result.reason).toContain('already has');
      expect(result.reason).toContain('--force');
    }
  });

  it('allows re-expansion with force option', async () => {
    const task = makeTask({
      id: 'T-1',
      type: 'task',
      complexity: 5,
      description: '- Step A\n- Step B\n- Step C',
      children: [makeTask({ id: 'T-1.1', type: 'subtask' })],
    });
    const result = await expandTask(task, 'task-only', {
      force: true,
      statesConfig: defaultStatesConfig,
    });

    expect('children' in result).toBe(true);
    if ('children' in result) {
      expect(result.children.length).toBeGreaterThan(0);
    }
  });

  it('returns dry-run result with estimated count', async () => {
    const task = makeTask({ id: 'T-1', type: 'task', complexity: 7 });
    const result = await expandTask(task, 'task-only', {
      dryRun: true,
      statesConfig: defaultStatesConfig,
    });

    expect('dryRun' in result).toBe(true);
    if ('dryRun' in result) {
      expect(result.dryRun).toBe(true);
      expect(result.children).toEqual([]);
      expect(result.estimatedCount).toBeGreaterThan(0);
    }
  });

  it('expands using heuristic when auth is not available', async () => {
    const task = makeTask({
      id: 'T-3',
      type: 'task',
      complexity: 6,
      title: 'Build auth',
      description: '- Setup OAuth\n- Token management\n- Session handling',
      requiredSkills: ['backend'],
      tags: ['auth'],
      priority: 'high',
    });

    const result = await expandTask(task, 'task-only', {
      statesConfig: defaultStatesConfig,
      authAvailable: false,
    });

    expect('children' in result).toBe(true);
    if ('children' in result) {
      expect(result.dryRun).toBe(false);
      expect(result.children.length).toBeGreaterThanOrEqual(2);

      // Verify child properties
      const child = result.children[0];
      expect(child.id).toBe('T-3.1');
      expect(child.type).toBe('subtask');
      expect(child.status).toBe('todo');
      expect(child.priority).toBe('high');
      expect(child.requiredSkills).toEqual(['backend']);
      expect(child.tags).toEqual(['auth']);
      expect(child.complexity).toBe(1);
      expect(child.metadata.autoExpanded).toBe(true);
      expect(child.metadata.source).toContain('T-3');
      expect(child.children).toEqual([]);
    }
  });

  it('expands using AI when authenticated', async () => {
    const mockResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify([
              { title: 'AI subtask 1', description: 'Generated by AI' },
              { title: 'AI subtask 2', description: 'Also generated' },
            ]),
          },
        },
      ],
    };
    vi.mocked(callAI).mockResolvedValueOnce(mockResponse);

    const task = makeTask({
      id: 'T-5',
      type: 'task',
      complexity: 7,
      title: 'Complex task',
      description: 'A complex task requiring AI decomposition',
    });

    const result = await expandTask(task, 'task-only', {
      statesConfig: defaultStatesConfig,
      authAvailable: true,
      model: 'gpt-4o',
    });

    expect(callAI).toHaveBeenCalledOnce();
    expect('children' in result).toBe(true);
    if ('children' in result) {
      expect(result.children).toHaveLength(2);
      expect(result.children[0].title).toBe('AI subtask 1');
      expect(result.children[1].title).toBe('AI subtask 2');
    }
  });

  it('falls back to heuristic when AI fails', async () => {
    vi.mocked(callAI).mockRejectedValueOnce(new Error('API error'));

    const task = makeTask({
      id: 'T-5',
      type: 'task',
      complexity: 7,
      title: 'Complex task',
      description: '- Step one\n- Step two\n- Step three',
    });

    const result = await expandTask(task, 'task-only', {
      statesConfig: defaultStatesConfig,
      authAvailable: true,
      model: 'gpt-4o',
    });

    expect('children' in result).toBe(true);
    if ('children' in result) {
      expect(result.children.length).toBeGreaterThan(0);
    }
  });

  it('falls back to heuristic when AI returns empty response', async () => {
    const mockResponse = {
      choices: [{ message: { content: '[]' } }],
    };
    vi.mocked(callAI).mockResolvedValueOnce(mockResponse);

    const task = makeTask({
      id: 'T-5',
      type: 'task',
      complexity: 7,
      title: 'Complex task',
      description: '- Fallback step one\n- Fallback step two',
    });

    const result = await expandTask(task, 'task-only', {
      statesConfig: defaultStatesConfig,
      authAvailable: true,
      model: 'gpt-4o',
    });

    expect('children' in result).toBe(true);
    if ('children' in result) {
      expect(result.children.length).toBeGreaterThan(0);
    }
  });

  it('respects maxSubtasks option', async () => {
    const task = makeTask({
      id: 'T-1',
      type: 'task',
      complexity: 9,
      description: '- A\n- B\n- C\n- D\n- E\n- F\n- G',
    });

    const result = await expandTask(task, 'task-only', {
      maxSubtasks: 3,
      statesConfig: defaultStatesConfig,
    });

    expect('children' in result).toBe(true);
    if ('children' in result) {
      expect(result.children.length).toBeLessThanOrEqual(3);
    }
  });

  it('generates correct IDs for nested expansion in agile-full', async () => {
    const task = makeTask({
      id: 'T-1',
      type: 'epic',
      complexity: 8,
      description: '- Feature A\n- Feature B',
    });

    const result = await expandTask(task, 'agile-full', {
      statesConfig: defaultStatesConfig,
    });

    expect('children' in result).toBe(true);
    if ('children' in result) {
      expect(result.children[0].id).toBe('T-1.1');
      expect(result.children[0].type).toBe('story');
      expect(result.children[1].id).toBe('T-1.2');
    }
  });
});

// ---- expandMultiple ----

describe('expandMultiple', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('expands only tasks above threshold with no children', async () => {
    const tasks = [
      makeTask({ id: 'T-1', complexity: 7, description: '- A\n- B\n- C' }),
      makeTask({ id: 'T-2', complexity: 3, description: 'Simple task' }),
      makeTask({ id: 'T-3', complexity: 8, description: '- X\n- Y\n- Z' }),
    ];

    const result = await expandMultiple(tasks, 'task-only', 5, {
      statesConfig: defaultStatesConfig,
    });

    expect(result.expanded).toHaveLength(2);
    expect(result.expanded[0].parentId).toBe('T-1');
    expect(result.expanded[1].parentId).toBe('T-3');
    expect(result.skipped).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it('skips already-expanded tasks', async () => {
    const tasks = [
      makeTask({
        id: 'T-1',
        complexity: 7,
        children: [makeTask({ id: 'T-1.1', type: 'subtask' })],
      }),
      makeTask({ id: 'T-2', complexity: 8, description: '- A\n- B' }),
    ];

    const result = await expandMultiple(tasks, 'task-only', 5, {
      statesConfig: defaultStatesConfig,
    });

    // T-1 is skipped (already has children), T-2 is expanded
    expect(result.expanded).toHaveLength(1);
    expect(result.expanded[0].parentId).toBe('T-2');
    expect(result.skipped).toBe(1);
  });

  it('collects errors for tasks at max depth', async () => {
    const tasks = [makeTask({ id: 'T-1', type: 'subtask', complexity: 7 })];

    const result = await expandMultiple(tasks, 'task-only', 5, {
      statesConfig: defaultStatesConfig,
    });

    expect(result.expanded).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toContain('maximum depth');
  });

  it('returns empty results when no tasks are eligible', async () => {
    const tasks = [makeTask({ id: 'T-1', complexity: 2 }), makeTask({ id: 'T-2', complexity: 3 })];

    const result = await expandMultiple(tasks, 'task-only', 5, {
      statesConfig: defaultStatesConfig,
    });

    expect(result.expanded).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.skipped).toBe(2);
  });
});
