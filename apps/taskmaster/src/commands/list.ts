import type { TaskNode } from '../config/schema.js';

export interface ListOpts {
  status?: string;
  type?: string;
  category?: string;
  skills?: string;
  compact?: boolean;
  format?: string;
}

export interface ListResult {
  tasks: TaskNode[];
  filters: {
    status?: string;
    category?: string;
    type?: string;
  };
}

/**
 * Execute the list command: filter tasks by skills and return
 * filtered tasks with filter context for template rendering.
 */
export function executeList(tasks: TaskNode[], opts: ListOpts = {}): ListResult {
  let filtered = tasks;

  if (opts.skills) {
    const filterSkills = opts.skills.split(',').map((s) => s.trim()).filter(Boolean);
    if (filterSkills.length > 0) {
      filtered = filtered.filter((t) =>
        t.requiredSkills.some((s) => filterSkills.includes(s)),
      );
    }
  }

  return {
    tasks: filtered,
    filters: {
      status: opts.status,
      category: opts.category,
      type: opts.type,
    },
  };
}
