import { homedir } from 'node:os';
import { join } from 'node:path';

export function homeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.HELMSMITH_HOME && env.HELMSMITH_HOME.length > 0
    ? env.HELMSMITH_HOME
    : join(homedir(), '.cache', 'helmsmith');
}

export const registryFile = (home: string) => join(home, 'registry.json');
export const lockDir = (home: string) => join(home, 'registry.lock');
