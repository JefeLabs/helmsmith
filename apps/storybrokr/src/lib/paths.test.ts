import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { configFile, daemonFile, homeDir, lockFile, stateFile } from './paths.js';

describe('paths', () => {
  it('defaults to ~/.storybrokr', () => {
    expect(homeDir({})).toBe(join(homedir(), '.storybrokr'));
  });

  it('honors STORYBROKR_HOME', () => {
    expect(homeDir({ STORYBROKR_HOME: '/tmp/sb-home' })).toBe('/tmp/sb-home');
  });

  it('derives the four files from the home dir', () => {
    expect(daemonFile('/h')).toBe('/h/daemon.json');
    expect(lockFile('/h')).toBe('/h/daemon.lock');
    expect(stateFile('/h')).toBe('/h/state.json');
    expect(configFile('/h')).toBe('/h/config.json');
  });
});
