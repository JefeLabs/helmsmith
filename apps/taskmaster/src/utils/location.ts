export type ProjectLocation = 'home' | 'repo';

export interface ResolvedProject {
  name: string;
  location: ProjectLocation;
  projectDir: string;
  taskmasterHome: string;
  gitRoot: string | null;
}

/**
 * Format a project reference for display.
 * e.g. "my-project [repo]" or "my-project [home]"
 */
export function formatProjectRef(name: string, location: ProjectLocation): string {
  return `${name} [${location}]`;
}

/**
 * Parse a project reference that may include a location qualifier.
 * Supports "repo:name" and "home:name" prefixes, or plain "name".
 */
export function parseProjectRef(ref: string): { name: string; location?: ProjectLocation } {
  if (ref.startsWith('repo:')) {
    return { name: ref.slice(5), location: 'repo' };
  }
  if (ref.startsWith('home:')) {
    return { name: ref.slice(5), location: 'home' };
  }
  return { name: ref };
}
