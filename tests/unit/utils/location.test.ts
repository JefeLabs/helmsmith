import { describe, it, expect } from 'vitest';
import {
  formatProjectRef,
  parseProjectRef,
  type ProjectLocation,
  type ResolvedProject,
} from '../../../src/utils/location.js';

describe('formatProjectRef', () => {
  it('formats home project ref', () => {
    expect(formatProjectRef('my-app', 'home')).toBe('my-app [home]');
  });

  it('formats repo project ref', () => {
    expect(formatProjectRef('my-app', 'repo')).toBe('my-app [repo]');
  });
});

describe('parseProjectRef', () => {
  it('parses plain name (no qualifier)', () => {
    const result = parseProjectRef('my-app');
    expect(result.name).toBe('my-app');
    expect(result.location).toBeUndefined();
  });

  it('parses repo: qualifier', () => {
    const result = parseProjectRef('repo:my-app');
    expect(result.name).toBe('my-app');
    expect(result.location).toBe('repo');
  });

  it('parses home: qualifier', () => {
    const result = parseProjectRef('home:my-app');
    expect(result.name).toBe('my-app');
    expect(result.location).toBe('home');
  });

  it('handles names with colons (no matching qualifier)', () => {
    const result = parseProjectRef('custom:value:name');
    // Not a known qualifier, so it's just a plain name
    expect(result.name).toBe('custom:value:name');
    expect(result.location).toBeUndefined();
  });

  it('handles empty name after qualifier', () => {
    const result = parseProjectRef('repo:');
    expect(result.name).toBe('');
    expect(result.location).toBe('repo');
  });
});

describe('ProjectLocation type', () => {
  it('accepts home and repo as valid values', () => {
    const home: ProjectLocation = 'home';
    const repo: ProjectLocation = 'repo';
    expect(home).toBe('home');
    expect(repo).toBe('repo');
  });
});

describe('ResolvedProject interface', () => {
  it('can be constructed with all required fields', () => {
    const resolved: ResolvedProject = {
      name: 'test-project',
      location: 'home',
      projectDir: '/home/user/.agentx/taskmaster/test-project',
      taskmasterHome: '/home/user/.agentx/taskmaster',
      gitRoot: null,
    };
    expect(resolved.name).toBe('test-project');
    expect(resolved.location).toBe('home');
    expect(resolved.gitRoot).toBeNull();
  });

  it('can be constructed with repo location and gitRoot', () => {
    const resolved: ResolvedProject = {
      name: 'repo-project',
      location: 'repo',
      projectDir: '/repo/.agentx/taskmaster/repo-project',
      taskmasterHome: '/repo/.agentx/taskmaster',
      gitRoot: '/repo',
    };
    expect(resolved.location).toBe('repo');
    expect(resolved.gitRoot).toBe('/repo');
  });
});
