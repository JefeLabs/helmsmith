import { describe, expect, it } from 'vitest';
import {
  analyzeAmbiguity,
  analyzeCrossCutting,
  analyzeDependencyCount,
  analyzeScopeBreadth,
  analyzeTechnicalDepth,
} from '../../../src/scorer/dimensions.js';
import { makeTask } from '../../fixtures/tasks.js';

describe('analyzeScopeBreadth', () => {
  it('returns 0 for a task with no relevant keywords', () => {
    const task = makeTask({ title: 'Do something', description: 'A generic task' });
    expect(analyzeScopeBreadth(task)).toBe(0);
  });

  it('returns ~0.17 for a task with one category match', () => {
    const task = makeTask({
      title: 'Build API endpoint',
      description: 'Create a new REST endpoint for users',
    });
    const score = analyzeScopeBreadth(task);
    // "api" and "endpoint" match backend category only
    expect(score).toBeCloseTo(1 / 6, 1);
  });

  it('returns higher score for multiple categories', () => {
    const task = makeTask({
      title: 'Full-stack auth feature',
      description:
        'Build frontend form, backend API endpoint, database schema, and auth token validation',
    });
    const score = analyzeScopeBreadth(task);
    // Should match: ui (form, frontend), backend (api, endpoint), data (database, schema), authSecurity (auth, token)
    expect(score).toBeGreaterThanOrEqual(4 / 6);
  });

  it('returns 1.0 when all categories are matched', () => {
    const task = makeTask({
      title: 'Everything',
      description:
        'Build frontend component with api endpoint, database model, deploy docker, auth token, unit test coverage',
    });
    const score = analyzeScopeBreadth(task);
    expect(score).toBe(1.0);
  });

  it('counts each category only once regardless of keyword frequency', () => {
    const task = makeTask({
      title: 'API API API endpoint endpoint',
      description: 'api endpoint route handler server controller',
    });
    const score = analyzeScopeBreadth(task);
    // All keywords are in the "backend" category, so score is 1/6
    expect(score).toBeCloseTo(1 / 6, 1);
  });
});

describe('analyzeTechnicalDepth', () => {
  it('returns 0 for a task with no depth indicators', () => {
    const task = makeTask({
      title: 'Write README',
      description: 'Add documentation for the project',
    });
    expect(analyzeTechnicalDepth(task)).toBe(0);
  });

  it('detects security depth', () => {
    const task = makeTask({
      title: 'Implement OAuth flow',
      description: 'Build OAuth device flow with token refresh and credential storage',
    });
    const score = analyzeTechnicalDepth(task);
    // Matches security (oauth, token, credential)
    expect(score).toBeGreaterThanOrEqual(1 / 5);
  });

  it('detects multiple depth categories', () => {
    const task = makeTask({
      title: 'Secure deployment pipeline',
      description:
        'Deploy to kubernetes with OAuth encryption, caching optimization, and external API webhook',
    });
    const score = analyzeTechnicalDepth(task);
    // Should match: infrastructure (deploy, kubernetes), security (oauth, encryption),
    // performance (caching, optimization), integration (api, webhook, external)
    expect(score).toBeGreaterThanOrEqual(4 / 5);
  });

  it('uses binary presence not frequency', () => {
    const task = makeTask({
      title: 'OAuth OAuth OAuth',
      description: 'oauth oauth oauth encryption encryption',
    });
    const score = analyzeTechnicalDepth(task);
    // Only security category matched, regardless of frequency
    expect(score).toBeCloseTo(1 / 5, 1);
  });
});

describe('analyzeDependencyCount', () => {
  it('returns 0 for a task with no dependencies in an empty list', () => {
    const task = makeTask({ id: 'T-1', dependencies: [] });
    expect(analyzeDependencyCount(task, [])).toBe(0);
  });

  it('returns 0 for a task with no dependencies and no incoming refs', () => {
    const task = makeTask({ id: 'T-1', dependencies: [] });
    const allTasks = [task, makeTask({ id: 'T-2', dependencies: [] })];
    expect(analyzeDependencyCount(task, allTasks)).toBe(0);
  });

  it('counts outgoing dependencies', () => {
    const task = makeTask({
      id: 'T-3',
      dependencies: [
        { taskId: 'T-1', type: 'blocks' },
        { taskId: 'T-2', type: 'produces' },
      ],
    });
    const allTasks = [makeTask({ id: 'T-1' }), makeTask({ id: 'T-2' }), task];
    const score = analyzeDependencyCount(task, allTasks);
    // 2 outgoing, 0 incoming = 2/8 = 0.25
    expect(score).toBeCloseTo(0.25, 2);
  });

  it('counts incoming dependencies (reverse lookup)', () => {
    const task = makeTask({ id: 'T-1', dependencies: [] });
    const allTasks = [
      task,
      makeTask({ id: 'T-2', dependencies: [{ taskId: 'T-1', type: 'blocks' }] }),
      makeTask({ id: 'T-3', dependencies: [{ taskId: 'T-1', type: 'produces' }] }),
      makeTask({ id: 'T-4', dependencies: [{ taskId: 'T-1', type: 'blocks' }] }),
    ];
    const score = analyzeDependencyCount(task, allTasks);
    // 0 outgoing, 3 incoming = 3/8 = 0.375
    expect(score).toBeCloseTo(0.375, 2);
  });

  it('counts both directions', () => {
    const task = makeTask({
      id: 'T-3',
      dependencies: [
        { taskId: 'T-1', type: 'blocks' },
        { taskId: 'T-2', type: 'blocks' },
        { taskId: 'T-4', type: 'blocks' },
      ],
    });
    const allTasks = [
      makeTask({ id: 'T-1' }),
      makeTask({ id: 'T-2' }),
      task,
      makeTask({ id: 'T-4' }),
      makeTask({ id: 'T-5', dependencies: [{ taskId: 'T-3', type: 'blocks' }] }),
      makeTask({ id: 'T-6', dependencies: [{ taskId: 'T-3', type: 'blocks' }] }),
    ];
    const score = analyzeDependencyCount(task, allTasks);
    // 3 outgoing + 2 incoming = 5/8 = 0.625
    expect(score).toBeCloseTo(0.625, 2);
  });

  it('caps at 1.0 for highly connected tasks', () => {
    const deps = Array.from({ length: 10 }, (_, i) => ({
      taskId: `T-${i + 1}`,
      type: 'blocks' as const,
    }));
    const task = makeTask({ id: 'T-100', dependencies: deps });
    const allTasks = [task, ...deps.map((d) => makeTask({ id: d.taskId }))];
    const score = analyzeDependencyCount(task, allTasks);
    expect(score).toBe(1.0);
  });
});

describe('analyzeAmbiguity', () => {
  it('returns 1.0 for an empty description', () => {
    const task = makeTask({ title: 'Something', description: '' });
    expect(analyzeAmbiguity(task)).toBe(1.0);
  });

  it('returns high score for a vague, short description', () => {
    const task = makeTask({
      title: 'Do stuff',
      description: 'Handle various things, TBD',
    });
    const score = analyzeAmbiguity(task);
    // Short description (< 50 chars) + vague indicators
    expect(score).toBeGreaterThan(0.5);
  });

  it('returns low score for a specific, detailed description', () => {
    const task = makeTask({
      title: 'Implement user authentication',
      description:
        'Create auth middleware in src/middleware/auth.ts that validates JWT tokens. ' +
        'Implement login endpoint at /api/auth/login that accepts email and password. ' +
        'Add 3 unit tests for token validation. Configure CORS headers in config.yaml.',
    });
    const score = analyzeAmbiguity(task);
    // Long, specific description with file paths, numbers, concrete verbs
    expect(score).toBeLessThan(0.4);
  });

  it('applies length penalty for short descriptions', () => {
    const shortTask = makeTask({
      title: 'Build feature',
      description: 'Implement the feature',
    });
    const longTask = makeTask({
      title: 'Build feature',
      description:
        'Implement the user registration feature with email validation, password hashing using bcrypt, ' +
        'and store user records in the PostgreSQL database via the users table',
    });
    const shortScore = analyzeAmbiguity(shortTask);
    const longScore = analyzeAmbiguity(longTask);
    // Short description gets a penalty, so it should score higher (more ambiguous)
    expect(shortScore).toBeGreaterThan(longScore);
  });

  it('returns 0.5 when no indicators are found', () => {
    const task = makeTask({
      title: 'neutral neutral neutral neutral neutral neutral neutral neutral',
      description:
        'neutral neutral neutral neutral neutral neutral neutral neutral neutral neutral neutral neutral',
    });
    const score = analyzeAmbiguity(task);
    expect(score).toBe(0.5);
  });
});

describe('analyzeCrossCutting', () => {
  it('returns 0 for a focused, single-area task', () => {
    const task = makeTask({
      title: 'Build login page',
      description: 'Create the login form with email and password fields',
    });
    expect(analyzeCrossCutting(task)).toBe(0);
  });

  it('detects boundary-crossing language', () => {
    const task = makeTask({
      title: 'End-to-end testing infrastructure',
      description: 'Set up shared testing utilities across all modules',
    });
    const score = analyzeCrossCutting(task);
    // "end-to-end", "shared", "across", "all modules"
    expect(score).toBeGreaterThanOrEqual(0.6);
  });

  it('detects multi-area phrases', () => {
    const task = makeTask({
      title: 'Global state management',
      description: 'Implement system-wide state that works throughout both frontend and backend',
    });
    const score = analyzeCrossCutting(task);
    // "global", "system-wide", "throughout", "both frontend and backend"
    expect(score).toBeGreaterThanOrEqual(0.6);
  });

  it('caps at 1.0 for heavily cross-cutting tasks', () => {
    const task = makeTask({
      title: 'Global shared infrastructure',
      description:
        'Build a system-wide, end-to-end, cross-cutting framework across all modules ' +
        'throughout every service for both frontend and backend',
    });
    const score = analyzeCrossCutting(task);
    expect(score).toBe(1.0);
  });
});
