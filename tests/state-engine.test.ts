import { describe, it, expect } from 'vitest';
import type { StatesConfig, StateDefinition, TaskNode } from '../src/config/schema.js';
import {
  resolveStates,
  validateTransition,
  getStateCategory,
  getDefaultStatus,
  isOpenState,
  isActiveState,
  isClosedState,
  getValidStatuses,
  findTaskById,
} from '../src/config/state-engine.js';

// --- resolveStates ---

describe('resolveStates', () => {
  it('returns simple preset states', () => {
    const states = resolveStates({ preset: 'simple', enforce_transitions: false });
    const names = states.map((s) => s.name);
    expect(names).toEqual(['todo', 'in-progress', 'done']);
  });

  it('returns standard preset states', () => {
    const states = resolveStates({ preset: 'standard', enforce_transitions: false });
    const names = states.map((s) => s.name);
    expect(names).toEqual(['backlog', 'todo', 'in-progress', 'review', 'blocked', 'done']);
  });

  it('returns kanban preset states', () => {
    const states = resolveStates({ preset: 'kanban', enforce_transitions: false });
    const names = states.map((s) => s.name);
    expect(names).toEqual([
      'backlog',
      'ready',
      'in-progress',
      'review',
      'testing',
      'blocked',
      'on-hold',
      'done',
    ]);
  });

  it('returns custom states when preset is custom', () => {
    const custom: StateDefinition[] = [
      { name: 'draft', category: 'open' },
      { name: 'approved', category: 'active' },
      { name: 'shipped', category: 'closed' },
    ];
    const states = resolveStates({ preset: 'custom', custom, enforce_transitions: false });
    expect(states).toEqual(custom);
  });

  it('throws when preset is custom but no custom array provided', () => {
    expect(() => resolveStates({ preset: 'custom', enforce_transitions: false })).toThrow(
      'no custom states are defined',
    );
  });

  it('throws when preset is custom but custom array is empty', () => {
    expect(() =>
      resolveStates({ preset: 'custom', custom: [], enforce_transitions: false }),
    ).toThrow('no custom states are defined');
  });

  it('returns a new array (not the frozen original)', () => {
    const states1 = resolveStates({ preset: 'simple', enforce_transitions: false });
    const states2 = resolveStates({ preset: 'simple', enforce_transitions: false });
    expect(states1).not.toBe(states2);
    expect(states1).toEqual(states2);
  });
});

// --- validateTransition ---

describe('validateTransition', () => {
  const standardStates = resolveStates({ preset: 'standard', enforce_transitions: true });

  it('rejects transition to nonexistent state regardless of enforce_transitions', () => {
    const result = validateTransition(standardStates, 'todo', 'nonexistent', false);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid target state "nonexistent"');
    expect(result.error).toContain('Valid states:');
  });

  it('rejects transition to nonexistent state when enforced', () => {
    const result = validateTransition(standardStates, 'todo', 'nonexistent', true);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid target state "nonexistent"');
  });

  it('allows any valid transition when enforce_transitions is false', () => {
    // backlog -> done is not in standard transitions, but should be allowed when not enforced
    const result = validateTransition(standardStates, 'backlog', 'done', false);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('allows transition that is in the transitions array when enforced', () => {
    // backlog -> todo is a valid standard transition
    const result = validateTransition(standardStates, 'backlog', 'todo', true);
    expect(result.valid).toBe(true);
  });

  it('rejects transition not in the transitions array when enforced', () => {
    // backlog -> done is NOT a valid standard transition
    const result = validateTransition(standardStates, 'backlog', 'done', true);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Cannot transition from "backlog" to "done"');
    expect(result.error).toContain('Allowed transitions from "backlog": todo');
    expect(result.error).toContain('Valid states:');
  });

  it('allows all transitions when transitions is undefined and enforced', () => {
    const states: StateDefinition[] = [
      { name: 'open', category: 'open' }, // no transitions key
      { name: 'closed', category: 'closed' },
    ];
    const result = validateTransition(states, 'open', 'closed', true);
    expect(result.valid).toBe(true);
  });

  it('rejects all transitions when transitions is empty array and enforced', () => {
    const states: StateDefinition[] = [
      { name: 'locked', category: 'active', transitions: [] },
      { name: 'other', category: 'open' },
    ];
    const result = validateTransition(states, 'locked', 'other', true);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('does not allow any transitions');
  });

  it('reports error for unrecognized from-state when enforced', () => {
    const result = validateTransition(standardStates, 'unknown-state', 'todo', true);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Current state "unknown-state" is not recognized');
  });

  it('error message includes valid transitions and valid states', () => {
    const result = validateTransition(standardStates, 'todo', 'done', true);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Allowed transitions from "todo": in-progress, blocked');
    expect(result.error).toContain('Valid states: backlog, todo, in-progress, review, blocked, done');
  });
});

// --- getStateCategory ---

describe('getStateCategory', () => {
  const states = resolveStates({ preset: 'standard', enforce_transitions: false });

  it('returns open for backlog', () => {
    expect(getStateCategory(states, 'backlog')).toBe('open');
  });

  it('returns open for todo', () => {
    expect(getStateCategory(states, 'todo')).toBe('open');
  });

  it('returns active for in-progress', () => {
    expect(getStateCategory(states, 'in-progress')).toBe('active');
  });

  it('returns active for review', () => {
    expect(getStateCategory(states, 'review')).toBe('active');
  });

  it('returns active for blocked', () => {
    expect(getStateCategory(states, 'blocked')).toBe('active');
  });

  it('returns closed for done', () => {
    expect(getStateCategory(states, 'done')).toBe('closed');
  });

  it('returns undefined for unknown state', () => {
    expect(getStateCategory(states, 'nonexistent')).toBeUndefined();
  });
});

// --- getDefaultStatus ---

describe('getDefaultStatus', () => {
  it('returns todo for simple preset', () => {
    expect(getDefaultStatus({ preset: 'simple', enforce_transitions: false })).toBe('todo');
  });

  it('returns backlog for standard preset', () => {
    expect(getDefaultStatus({ preset: 'standard', enforce_transitions: false })).toBe('backlog');
  });

  it('returns backlog for kanban preset', () => {
    expect(getDefaultStatus({ preset: 'kanban', enforce_transitions: false })).toBe('backlog');
  });

  it('returns first open state for custom config', () => {
    const config: StatesConfig = {
      preset: 'custom',
      custom: [
        { name: 'active-first', category: 'active' },
        { name: 'my-open', category: 'open' },
        { name: 'done', category: 'closed' },
      ],
      enforce_transitions: false,
    };
    expect(getDefaultStatus(config)).toBe('my-open');
  });

  it('falls back to first state if no open category exists', () => {
    const config: StatesConfig = {
      preset: 'custom',
      custom: [
        { name: 'working', category: 'active' },
        { name: 'finished', category: 'closed' },
      ],
      enforce_transitions: false,
    };
    expect(getDefaultStatus(config)).toBe('working');
  });
});

// --- isOpenState, isActiveState, isClosedState ---

describe('isOpenState', () => {
  const states = resolveStates({ preset: 'standard', enforce_transitions: false });

  it('returns true for open states', () => {
    expect(isOpenState(states, 'backlog')).toBe(true);
    expect(isOpenState(states, 'todo')).toBe(true);
  });

  it('returns false for non-open states', () => {
    expect(isOpenState(states, 'in-progress')).toBe(false);
    expect(isOpenState(states, 'done')).toBe(false);
  });

  it('returns false for unknown states', () => {
    expect(isOpenState(states, 'nonexistent')).toBe(false);
  });
});

describe('isActiveState', () => {
  const states = resolveStates({ preset: 'standard', enforce_transitions: false });

  it('returns true for active states', () => {
    expect(isActiveState(states, 'in-progress')).toBe(true);
    expect(isActiveState(states, 'review')).toBe(true);
    expect(isActiveState(states, 'blocked')).toBe(true);
  });

  it('returns false for non-active states', () => {
    expect(isActiveState(states, 'todo')).toBe(false);
    expect(isActiveState(states, 'done')).toBe(false);
  });
});

describe('isClosedState', () => {
  const states = resolveStates({ preset: 'standard', enforce_transitions: false });

  it('returns true for closed states', () => {
    expect(isClosedState(states, 'done')).toBe(true);
  });

  it('returns false for non-closed states', () => {
    expect(isClosedState(states, 'todo')).toBe(false);
    expect(isClosedState(states, 'in-progress')).toBe(false);
  });
});

// --- getValidStatuses ---

describe('getValidStatuses', () => {
  it('returns all state names for standard preset', () => {
    const states = resolveStates({ preset: 'standard', enforce_transitions: false });
    expect(getValidStatuses(states)).toEqual([
      'backlog',
      'todo',
      'in-progress',
      'review',
      'blocked',
      'done',
    ]);
  });

  it('returns all state names for simple preset', () => {
    const states = resolveStates({ preset: 'simple', enforce_transitions: false });
    expect(getValidStatuses(states)).toEqual(['todo', 'in-progress', 'done']);
  });
});

// --- findTaskById ---

describe('findTaskById', () => {
  const tasks: TaskNode[] = [
    {
      id: 'T-1',
      title: 'Task 1',
      description: '',
      type: 'task',
      status: 'todo',
      complexity: 3,
      priority: 'medium',
      requiredSkills: [],
      dependencies: [],
      readiness: 'pending',
      assignee: null,
      outputs: [],
      tags: [],
      children: [
        {
          id: 'T-1.1',
          title: 'Subtask 1.1',
          description: '',
          type: 'subtask',
          status: 'todo',
          complexity: 1,
          priority: 'medium',
          requiredSkills: [],
          dependencies: [],
          readiness: 'pending',
          assignee: null,
          outputs: [],
          tags: [],
          children: [],
          metadata: { source: '', autoExpanded: false, skillsInferred: false, createdAt: '' },
        },
      ],
      metadata: { source: '', autoExpanded: false, skillsInferred: false, createdAt: '' },
    },
    {
      id: 'T-2',
      title: 'Task 2',
      description: '',
      type: 'task',
      status: 'in-progress',
      complexity: 5,
      priority: 'high',
      requiredSkills: [],
      dependencies: [],
      readiness: 'pending',
      assignee: null,
      outputs: [],
      tags: [],
      children: [],
      metadata: { source: '', autoExpanded: false, skillsInferred: false, createdAt: '' },
    },
  ];

  it('finds a top-level task by ID', () => {
    const result = findTaskById(tasks, 'T-1');
    expect(result).toBeDefined();
    expect(result!.id).toBe('T-1');
  });

  it('finds a nested child task by ID', () => {
    const result = findTaskById(tasks, 'T-1.1');
    expect(result).toBeDefined();
    expect(result!.id).toBe('T-1.1');
    expect(result!.title).toBe('Subtask 1.1');
  });

  it('finds a second top-level task', () => {
    const result = findTaskById(tasks, 'T-2');
    expect(result).toBeDefined();
    expect(result!.id).toBe('T-2');
  });

  it('returns undefined for nonexistent ID', () => {
    const result = findTaskById(tasks, 'T-999');
    expect(result).toBeUndefined();
  });

  it('returns undefined for empty tasks array', () => {
    const result = findTaskById([], 'T-1');
    expect(result).toBeUndefined();
  });
});
