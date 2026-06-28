import type { StateDefinition, StatesConfig, TaskNode } from './schema.js';
import { STATE_PRESETS } from './state-presets.js';

/**
 * Resolve a StatesConfig into a concrete list of StateDefinition objects.
 * Expands preset names into their full definitions.
 * This is the single source of truth for "what states exist in this project."
 */
export function resolveStates(config: StatesConfig): StateDefinition[] {
  if (config.preset === 'custom') {
    if (!config.custom || config.custom.length === 0) {
      throw new Error(
        'States preset is "custom" but no custom states are defined. ' +
          'Add a "custom" array to the states config with at least one state definition.',
      );
    }
    return [...config.custom];
  }

  const preset = STATE_PRESETS[config.preset];
  if (!preset) {
    throw new Error(
      `Unknown states preset "${config.preset}". Valid presets: ${Object.keys(STATE_PRESETS).join(', ')}`,
    );
  }

  return [...preset];
}

/**
 * Validate a status transition.
 *
 * Always validates that the target state exists in the resolved state list,
 * regardless of enforceTransitions. When enforceTransitions is true, also
 * checks that the transition is allowed by the source state's transitions array.
 *
 * Transition semantics:
 * - transitions: undefined  -> all transitions allowed from this state
 * - transitions: []         -> no transitions allowed (locked)
 * - transitions: ['a', 'b'] -> only transitions to 'a' or 'b' allowed
 */
export function validateTransition(
  states: StateDefinition[],
  fromStatus: string,
  toStatus: string,
  enforceTransitions: boolean,
): { valid: boolean; error?: string } {
  const validNames = states.map((s) => s.name);

  // Always validate target state exists
  if (!validNames.includes(toStatus)) {
    return {
      valid: false,
      error: `Invalid target state "${toStatus}". ` + `Valid states: ${validNames.join(', ')}`,
    };
  }

  // If not enforcing transitions, any move to a valid state is OK
  if (!enforceTransitions) {
    return { valid: true };
  }

  // Find the source state definition
  const fromState = states.find((s) => s.name === fromStatus);
  if (!fromState) {
    return {
      valid: false,
      error:
        `Current state "${fromStatus}" is not recognized. ` +
        `Valid states: ${validNames.join(', ')}`,
    };
  }

  // transitions: undefined -> all transitions allowed
  if (fromState.transitions === undefined) {
    return { valid: true };
  }

  // transitions: [] -> locked, no transitions allowed
  if (fromState.transitions.length === 0) {
    return {
      valid: false,
      error:
        `State "${fromStatus}" does not allow any transitions. ` +
        `Valid states: ${validNames.join(', ')}`,
    };
  }

  // Check if the target is in the allowed transitions
  if (!fromState.transitions.includes(toStatus)) {
    return {
      valid: false,
      error:
        `Cannot transition from "${fromStatus}" to "${toStatus}". ` +
        `Allowed transitions from "${fromStatus}": ${fromState.transitions.join(', ')}. ` +
        `Valid states: ${validNames.join(', ')}`,
    };
  }

  return { valid: true };
}

/**
 * Get the category of a state by name.
 * Returns undefined if the state is not found.
 */
export function getStateCategory(
  states: StateDefinition[],
  statusName: string,
): 'open' | 'active' | 'closed' | undefined {
  const state = states.find((s) => s.name === statusName);
  return state?.category;
}

/**
 * Get the default status for new tasks: the first state in the 'open' category.
 * Falls back to the first state in the list if no open state exists.
 */
export function getDefaultStatus(config: StatesConfig): string {
  const states = resolveStates(config);
  const openState = states.find((s) => s.category === 'open');
  return openState ? openState.name : states[0].name;
}

/**
 * Check if a status belongs to the 'open' category.
 */
export function isOpenState(states: StateDefinition[], status: string): boolean {
  return getStateCategory(states, status) === 'open';
}

/**
 * Check if a status belongs to the 'active' category.
 */
export function isActiveState(states: StateDefinition[], status: string): boolean {
  return getStateCategory(states, status) === 'active';
}

/**
 * Check if a status belongs to the 'closed' category.
 */
export function isClosedState(states: StateDefinition[], status: string): boolean {
  return getStateCategory(states, status) === 'closed';
}

/**
 * Get all valid status names from the resolved state list.
 */
export function getValidStatuses(states: StateDefinition[]): string[] {
  return states.map((s) => s.name);
}

/**
 * Find a task by ID, searching recursively through children.
 * Returns the task node or undefined if not found.
 */
export function findTaskById(tasks: TaskNode[], id: string): TaskNode | undefined {
  for (const task of tasks) {
    if (task.id === id) {
      return task;
    }
    if (task.children.length > 0) {
      const found = findTaskById(task.children, id);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}
