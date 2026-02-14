import type { StateDefinition } from './schema.js';

// Simple preset: todo -> in-progress -> done
export const SIMPLE_PRESET: readonly StateDefinition[] = Object.freeze([
  Object.freeze({ name: 'todo', category: 'open' as const }),
  Object.freeze({ name: 'in-progress', category: 'active' as const }),
  Object.freeze({ name: 'done', category: 'closed' as const }),
]);

// Standard preset: backlog -> todo -> in-progress -> review -> done + blocked
export const STANDARD_PRESET: readonly StateDefinition[] = Object.freeze([
  Object.freeze({ name: 'backlog', category: 'open' as const, transitions: ['todo'] }),
  Object.freeze({ name: 'todo', category: 'open' as const, transitions: ['in-progress', 'blocked'] }),
  Object.freeze({
    name: 'in-progress',
    category: 'active' as const,
    transitions: ['review', 'blocked', 'todo'],
  }),
  Object.freeze({ name: 'review', category: 'active' as const, transitions: ['done', 'in-progress'] }),
  Object.freeze({ name: 'blocked', category: 'active' as const, transitions: ['todo', 'in-progress'] }),
  Object.freeze({ name: 'done', category: 'closed' as const, transitions: ['in-progress'] }),
]);

// Kanban preset: backlog -> ready -> in-progress -> review -> testing -> done + blocked + on-hold
export const KANBAN_PRESET: readonly StateDefinition[] = Object.freeze([
  Object.freeze({ name: 'backlog', category: 'open' as const, transitions: ['ready'] }),
  Object.freeze({
    name: 'ready',
    category: 'open' as const,
    transitions: ['in-progress', 'blocked'],
  }),
  Object.freeze({
    name: 'in-progress',
    category: 'active' as const,
    transitions: ['review', 'blocked', 'on-hold', 'ready'],
  }),
  Object.freeze({ name: 'review', category: 'active' as const, transitions: ['testing', 'in-progress'] }),
  Object.freeze({
    name: 'testing',
    category: 'active' as const,
    transitions: ['done', 'in-progress'],
  }),
  Object.freeze({
    name: 'blocked',
    category: 'active' as const,
    transitions: ['ready', 'in-progress'],
  }),
  Object.freeze({
    name: 'on-hold',
    category: 'active' as const,
    transitions: ['in-progress', 'backlog'],
  }),
  Object.freeze({ name: 'done', category: 'closed' as const, transitions: ['in-progress'] }),
]);

// Map preset names to their definitions
export const STATE_PRESETS: Record<string, readonly StateDefinition[]> = {
  simple: SIMPLE_PRESET,
  standard: STANDARD_PRESET,
  kanban: KANBAN_PRESET,
};

// List of valid preset names
export const PRESET_NAMES = Object.keys(STATE_PRESETS);
