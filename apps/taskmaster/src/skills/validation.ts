import type { TaskNode } from '../config/schema.js';
import type { SkillValidationIssue } from './types.js';

/**
 * Find the closest match for a skill in the vocabulary.
 * Checks prefix match first, then substring match.
 * Returns the closest vocabulary skill or null if no match found.
 */
export function findClosestMatch(skill: string, vocabulary: string[]): string | null {
  const lower = skill.toLowerCase();

  // Prefix match: vocabulary skill starts with the input
  for (const v of vocabulary) {
    if (v.toLowerCase().startsWith(lower)) {
      return v;
    }
  }

  // Reverse prefix: input starts with a vocabulary skill
  for (const v of vocabulary) {
    if (lower.startsWith(v.toLowerCase())) {
      return v;
    }
  }

  // Substring match: vocabulary skill contains the input
  for (const v of vocabulary) {
    if (v.toLowerCase().includes(lower) || lower.includes(v.toLowerCase())) {
      return v;
    }
  }

  return null;
}

/**
 * Validate that all task skills are in the project vocabulary.
 * Recursively checks children. Returns issues for out-of-vocabulary skills
 * with closest-match suggestions where possible.
 */
export function validateSkills(tasks: TaskNode[], vocabulary: string[]): SkillValidationIssue[] {
  const issues: SkillValidationIssue[] = [];

  function check(taskList: TaskNode[]): void {
    for (const task of taskList) {
      for (const skill of task.requiredSkills) {
        if (!vocabulary.includes(skill)) {
          issues.push({
            taskId: task.id,
            skill,
            suggestion: findClosestMatch(skill, vocabulary),
          });
        }
      }
      if (task.children.length > 0) {
        check(task.children);
      }
    }
  }

  check(tasks);
  return issues;
}
