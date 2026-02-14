export interface ProjectStyle {
  name: string;
  hierarchy: string[];
  maxDepth: number;
  useCase: string;
}

export const PROJECT_STYLES: Record<string, ProjectStyle> = {
  'agile-full': {
    name: 'Agile Full',
    hierarchy: ['epic', 'story', 'task', 'subtask'],
    maxDepth: 4,
    useCase: 'Large-scale product development with cross-team coordination',
  },
  'story-driven': {
    name: 'Story-Driven',
    hierarchy: ['story', 'task', 'subtask'],
    maxDepth: 3,
    useCase: 'Feature-focused development for small-to-mid teams',
  },
  'task-only': {
    name: 'Task-Only',
    hierarchy: ['task', 'subtask'],
    maxDepth: 2,
    useCase: 'Lightweight sprint planning and solo projects',
  },
  flat: {
    name: 'Flat',
    hierarchy: ['task'],
    maxDepth: 1,
    useCase: 'Simple checklists, quick prototyping, or proof-of-concept work',
  },
};

export const STYLE_NAMES = Object.keys(PROJECT_STYLES);

/**
 * Get a project style by key.
 */
export function getStyle(key: string): ProjectStyle | undefined {
  return PROJECT_STYLES[key];
}

/**
 * Get valid task types for a given style.
 */
export function getValidTypes(styleKey: string): string[] {
  const style = PROJECT_STYLES[styleKey];
  return style ? style.hierarchy : ['task'];
}
