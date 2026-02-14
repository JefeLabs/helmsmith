import { describe, it, expect } from 'vitest';
import {
  SIMPLE_PRESET,
  STANDARD_PRESET,
  KANBAN_PRESET,
  STATE_PRESETS,
  PRESET_NAMES,
} from '../src/config/state-presets.js';

describe('SIMPLE_PRESET', () => {
  it('has exactly 3 states: todo, in-progress, done', () => {
    const names = SIMPLE_PRESET.map((s) => s.name);
    expect(names).toEqual(['todo', 'in-progress', 'done']);
  });

  it('has correct categories', () => {
    expect(SIMPLE_PRESET[0].category).toBe('open');
    expect(SIMPLE_PRESET[1].category).toBe('active');
    expect(SIMPLE_PRESET[2].category).toBe('closed');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(SIMPLE_PRESET)).toBe(true);
  });
});

describe('STANDARD_PRESET', () => {
  it('has 6 states: backlog, todo, in-progress, review, blocked, done', () => {
    const names = STANDARD_PRESET.map((s) => s.name);
    expect(names).toEqual(['backlog', 'todo', 'in-progress', 'review', 'blocked', 'done']);
  });

  it('has correct categories', () => {
    const categories = Object.fromEntries(STANDARD_PRESET.map((s) => [s.name, s.category]));
    expect(categories).toEqual({
      backlog: 'open',
      todo: 'open',
      'in-progress': 'active',
      review: 'active',
      blocked: 'active',
      done: 'closed',
    });
  });

  it('all transitions reference valid states within the preset', () => {
    const validNames = STANDARD_PRESET.map((s) => s.name);
    for (const state of STANDARD_PRESET) {
      if (state.transitions) {
        for (const target of state.transitions) {
          expect(validNames).toContain(target);
        }
      }
    }
  });

  it('is frozen', () => {
    expect(Object.isFrozen(STANDARD_PRESET)).toBe(true);
  });
});

describe('KANBAN_PRESET', () => {
  it('has 8 states', () => {
    const names = KANBAN_PRESET.map((s) => s.name);
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

  it('has correct categories', () => {
    const categories = Object.fromEntries(KANBAN_PRESET.map((s) => [s.name, s.category]));
    expect(categories).toEqual({
      backlog: 'open',
      ready: 'open',
      'in-progress': 'active',
      review: 'active',
      testing: 'active',
      blocked: 'active',
      'on-hold': 'active',
      done: 'closed',
    });
  });

  it('all transitions reference valid states within the preset', () => {
    const validNames = KANBAN_PRESET.map((s) => s.name);
    for (const state of KANBAN_PRESET) {
      if (state.transitions) {
        for (const target of state.transitions) {
          expect(validNames).toContain(target);
        }
      }
    }
  });

  it('is frozen', () => {
    expect(Object.isFrozen(KANBAN_PRESET)).toBe(true);
  });
});

describe('STATE_PRESETS', () => {
  it('maps simple, standard, and kanban to their presets', () => {
    expect(STATE_PRESETS.simple).toBe(SIMPLE_PRESET);
    expect(STATE_PRESETS.standard).toBe(STANDARD_PRESET);
    expect(STATE_PRESETS.kanban).toBe(KANBAN_PRESET);
  });

  it('has exactly 3 entries', () => {
    expect(Object.keys(STATE_PRESETS)).toHaveLength(3);
  });
});

describe('PRESET_NAMES', () => {
  it('matches the keys of STATE_PRESETS', () => {
    expect(PRESET_NAMES).toEqual(Object.keys(STATE_PRESETS));
  });

  it('contains simple, standard, kanban', () => {
    expect(PRESET_NAMES).toContain('simple');
    expect(PRESET_NAMES).toContain('standard');
    expect(PRESET_NAMES).toContain('kanban');
  });
});
