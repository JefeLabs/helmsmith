import { describe, it, expect } from 'vitest';
import {
  SIMPLE_PRESET,
  STANDARD_PRESET,
  KANBAN_PRESET,
  STATE_PRESETS,
  PRESET_NAMES,
} from '../src/config/state-presets.js';

describe('SIMPLE_PRESET', () => {
  it('has exactly 4 states: todo, in-progress, qa-failed, done', () => {
    const names = SIMPLE_PRESET.map((s) => s.name);
    expect(names).toEqual(['todo', 'in-progress', 'qa-failed', 'done']);
  });

  it('has correct categories', () => {
    const categories = Object.fromEntries(SIMPLE_PRESET.map((s) => [s.name, s.category]));
    expect(categories).toEqual({
      todo: 'open',
      'in-progress': 'active',
      'qa-failed': 'active',
      done: 'closed',
    });
  });

  it('qa-failed transitions to in-progress', () => {
    const qaFailed = SIMPLE_PRESET.find((s) => s.name === 'qa-failed');
    expect(qaFailed?.transitions).toEqual(['in-progress']);
  });

  it('done transitions include qa-failed', () => {
    const done = SIMPLE_PRESET.find((s) => s.name === 'done');
    expect(done?.transitions).toContain('qa-failed');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(SIMPLE_PRESET)).toBe(true);
  });
});

describe('STANDARD_PRESET', () => {
  it('has 7 states: backlog, todo, in-progress, review, blocked, qa-failed, done', () => {
    const names = STANDARD_PRESET.map((s) => s.name);
    expect(names).toEqual(['backlog', 'todo', 'in-progress', 'review', 'blocked', 'qa-failed', 'done']);
  });

  it('has correct categories', () => {
    const categories = Object.fromEntries(STANDARD_PRESET.map((s) => [s.name, s.category]));
    expect(categories).toEqual({
      backlog: 'open',
      todo: 'open',
      'in-progress': 'active',
      review: 'active',
      blocked: 'active',
      'qa-failed': 'active',
      done: 'closed',
    });
  });

  it('qa-failed transitions to in-progress and todo', () => {
    const qaFailed = STANDARD_PRESET.find((s) => s.name === 'qa-failed');
    expect(qaFailed?.transitions).toEqual(['in-progress', 'todo']);
  });

  it('review and done can transition to qa-failed', () => {
    const review = STANDARD_PRESET.find((s) => s.name === 'review');
    expect(review?.transitions).toContain('qa-failed');
    const done = STANDARD_PRESET.find((s) => s.name === 'done');
    expect(done?.transitions).toContain('qa-failed');
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
  it('has 9 states', () => {
    const names = KANBAN_PRESET.map((s) => s.name);
    expect(names).toEqual([
      'backlog',
      'ready',
      'in-progress',
      'review',
      'testing',
      'blocked',
      'on-hold',
      'qa-failed',
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
      'qa-failed': 'active',
      done: 'closed',
    });
  });

  it('qa-failed transitions to in-progress and ready', () => {
    const qaFailed = KANBAN_PRESET.find((s) => s.name === 'qa-failed');
    expect(qaFailed?.transitions).toEqual(['in-progress', 'ready']);
  });

  it('testing and done can transition to qa-failed', () => {
    const testing = KANBAN_PRESET.find((s) => s.name === 'testing');
    expect(testing?.transitions).toContain('qa-failed');
    const done = KANBAN_PRESET.find((s) => s.name === 'done');
    expect(done?.transitions).toContain('qa-failed');
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
