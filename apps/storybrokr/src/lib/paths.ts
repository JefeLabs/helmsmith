import { homedir } from 'node:os';
import { join } from 'node:path';

export function homeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.STORYBROKR_HOME && env.STORYBROKR_HOME.length > 0
    ? env.STORYBROKR_HOME
    : join(homedir(), '.storybrokr');
}

export const daemonFile = (home: string) => join(home, 'daemon.json');
export const lockFile = (home: string) => join(home, 'daemon.lock');
export const stateFile = (home: string) => join(home, 'state.json');
export const configFile = (home: string) => join(home, 'config.json');
