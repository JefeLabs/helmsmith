import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Mock callAI to return fixture data
vi.mock('../../../../src/auth/call-ai.js', () => ({
  callAI: vi.fn(),
}));

// Mock chalk to avoid ANSI codes in test output
vi.mock('chalk', () => ({
  default: {
    dim: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
  },
}));

import { callAI } from '../../../../src/auth/call-ai.js';
import { runAnalysisPipeline } from '../../../../src/parser/analysis/analyzer.js';

const mockedCallAI = vi.mocked(callAI);
const fixturesDir = join(import.meta.dirname, '../../../fixtures/analysis');

const sampleAnalysis = readFileSync(join(fixturesDir, 'sample-analysis.json'), 'utf-8');
const samplePhase2 = readFileSync(join(fixturesDir, 'sample-phase2-response.json'), 'utf-8');

describe('runAnalysisPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('runs both phases and returns tasks with tags', async () => {
    // Phase 1: architecture discovery
    mockedCallAI.mockResolvedValueOnce({
      choices: [{ message: { content: sampleAnalysis } }],
    });
    // Phase 2: task generation
    mockedCallAI.mockResolvedValueOnce({
      choices: [{ message: { content: samplePhase2 } }],
    });

    const result = await runAnalysisPipeline('# PRD\nBuild an e-commerce platform.', {
      style: 'task-only',
      defaultStatus: 'todo',
      model: 'gpt-4o',
    });

    // Check analysis
    expect(result.analysis.components).toHaveLength(4);
    expect(result.analysis.interfaces).toHaveLength(3);

    // Check tasks
    expect(result.tasks).toHaveLength(5);
    expect(result.tasks[0].title).toBe('Implement Auth Service');
    expect(result.tasks[0].tags).toContain('component:auth-service');
    expect(result.tasks[0].tags).toContain('layer:backend');
    expect(result.tasks[0].metadata.source).toBe('ai-architecture');
  });

  it('resolves title-based dependencies to IDs', async () => {
    mockedCallAI.mockResolvedValueOnce({
      choices: [{ message: { content: sampleAnalysis } }],
    });
    mockedCallAI.mockResolvedValueOnce({
      choices: [{ message: { content: samplePhase2 } }],
    });

    const result = await runAnalysisPipeline('PRD', {
      style: 'task-only',
      defaultStatus: 'todo',
      model: 'gpt-4o',
    });

    // "Implement Product Catalog" depends on "Implement Auth Service"
    const productTask = result.tasks.find(t => t.title === 'Implement Product Catalog');
    expect(productTask).toBeDefined();
    expect(productTask!.dependencies.length).toBeGreaterThan(0);

    const authTask = result.tasks.find(t => t.title === 'Implement Auth Service');
    expect(productTask!.dependencies.some(d => d.taskId === authTask!.id)).toBe(true);
  });

  it('infers interface dependencies between component tasks', async () => {
    mockedCallAI.mockResolvedValueOnce({
      choices: [{ message: { content: sampleAnalysis } }],
    });
    mockedCallAI.mockResolvedValueOnce({
      choices: [{ message: { content: samplePhase2 } }],
    });

    const result = await runAnalysisPipeline('PRD', {
      style: 'task-only',
      defaultStatus: 'todo',
      model: 'gpt-4o',
    });

    // web-frontend -> auth-service interface should add dependency
    const frontendTask = result.tasks.find(t => t.tags.includes('component:web-frontend'));
    const authTask = result.tasks.find(t => t.tags.includes('component:auth-service'));

    if (frontendTask && authTask) {
      expect(frontendTask.dependencies.some(d => d.taskId === authTask.id)).toBe(true);
    }
  });

  it('hydrates children into proper TaskNode structure', async () => {
    mockedCallAI.mockResolvedValueOnce({
      choices: [{ message: { content: sampleAnalysis } }],
    });
    mockedCallAI.mockResolvedValueOnce({
      choices: [{ message: { content: samplePhase2 } }],
    });

    const result = await runAnalysisPipeline('PRD', {
      style: 'task-only',
      defaultStatus: 'todo',
      model: 'gpt-4o',
    });

    const authTask = result.tasks[0];
    expect(authTask.children).toHaveLength(2);
    expect(authTask.children[0].id).toBe('1.1');
    expect(authTask.children[1].id).toBe('1.2');
    expect(authTask.children[0].status).toBe('todo');
    expect(authTask.children[0].tags).toContain('datasource:users-db');
  });

  it('calls callAI with correct caller tags', async () => {
    mockedCallAI.mockResolvedValueOnce({
      choices: [{ message: { content: sampleAnalysis } }],
    });
    mockedCallAI.mockResolvedValueOnce({
      choices: [{ message: { content: samplePhase2 } }],
    });

    await runAnalysisPipeline('PRD', {
      style: 'task-only',
      defaultStatus: 'todo',
      model: 'gpt-4o',
      provider: 'anthropic',
    });

    // Phase 1 call
    expect(mockedCallAI).toHaveBeenCalledTimes(2);
    expect(mockedCallAI.mock.calls[0][3]).toBe('parser-analysis');
    expect(mockedCallAI.mock.calls[0][2]).toBe('anthropic');

    // Phase 2 call
    expect(mockedCallAI.mock.calls[1][3]).toBe('parser-taskgen');
    expect(mockedCallAI.mock.calls[1][2]).toBe('anthropic');
  });

  it('throws when Phase 1 returns empty response', async () => {
    mockedCallAI.mockResolvedValueOnce({
      choices: [{ message: { content: '' } }],
    });

    await expect(
      runAnalysisPipeline('PRD', {
        style: 'task-only',
        defaultStatus: 'todo',
        model: 'gpt-4o',
      }),
    ).rejects.toThrow('Phase 1 AI returned empty response');
  });

  it('throws when Phase 1 returns invalid JSON', async () => {
    mockedCallAI.mockResolvedValueOnce({
      choices: [{ message: { content: 'not json at all' } }],
    });

    await expect(
      runAnalysisPipeline('PRD', {
        style: 'task-only',
        defaultStatus: 'todo',
        model: 'gpt-4o',
      }),
    ).rejects.toThrow('Phase 1 response failed validation');
  });

  it('throws when Phase 2 returns no tasks', async () => {
    mockedCallAI.mockResolvedValueOnce({
      choices: [{ message: { content: sampleAnalysis } }],
    });
    mockedCallAI.mockResolvedValueOnce({
      choices: [{ message: { content: '{"tasks": []}' } }],
    });

    await expect(
      runAnalysisPipeline('PRD', {
        style: 'task-only',
        defaultStatus: 'todo',
        model: 'gpt-4o',
      }),
    ).rejects.toThrow('Phase 2 returned no tasks');
  });

  it('handles code-fenced JSON responses', async () => {
    const fencedAnalysis = '```json\n' + sampleAnalysis + '\n```';
    const fencedPhase2 = '```json\n' + samplePhase2 + '\n```';

    mockedCallAI.mockResolvedValueOnce({
      choices: [{ message: { content: fencedAnalysis } }],
    });
    mockedCallAI.mockResolvedValueOnce({
      choices: [{ message: { content: fencedPhase2 } }],
    });

    const result = await runAnalysisPipeline('PRD', {
      style: 'task-only',
      defaultStatus: 'todo',
      model: 'gpt-4o',
    });

    expect(result.tasks.length).toBeGreaterThan(0);
  });

  it('skips scanning when skipScan is true', async () => {
    mockedCallAI.mockResolvedValueOnce({
      choices: [{ message: { content: sampleAnalysis } }],
    });
    mockedCallAI.mockResolvedValueOnce({
      choices: [{ message: { content: samplePhase2 } }],
    });

    const result = await runAnalysisPipeline('PRD', {
      style: 'task-only',
      defaultStatus: 'todo',
      model: 'gpt-4o',
      codebasePath: '/some/path',
      skipScan: true,
    });

    // Should still work but without scan data
    expect(result.tasks.length).toBeGreaterThan(0);
    // Phase 1 user message should NOT contain codebase scan
    const phase1UserMsg = mockedCallAI.mock.calls[0][0][1].content;
    expect(phase1UserMsg).not.toContain('=== CODEBASE SCAN ===');
  });

  it('uses correct default status for all tasks', async () => {
    mockedCallAI.mockResolvedValueOnce({
      choices: [{ message: { content: sampleAnalysis } }],
    });
    mockedCallAI.mockResolvedValueOnce({
      choices: [{ message: { content: samplePhase2 } }],
    });

    const result = await runAnalysisPipeline('PRD', {
      style: 'task-only',
      defaultStatus: 'backlog',
      model: 'gpt-4o',
    });

    for (const task of result.tasks) {
      expect(task.status).toBe('backlog');
      for (const child of task.children) {
        expect(child.status).toBe('backlog');
      }
    }
  });

  it('returns undefined indexes when no codebasePath provided', async () => {
    mockedCallAI.mockResolvedValueOnce({
      choices: [{ message: { content: sampleAnalysis } }],
    });
    mockedCallAI.mockResolvedValueOnce({
      choices: [{ message: { content: samplePhase2 } }],
    });

    const result = await runAnalysisPipeline('PRD', {
      style: 'task-only',
      defaultStatus: 'todo',
      model: 'gpt-4o',
    });

    // No codebasePath means no component discovery, no indexes
    expect(result.componentIndex).toBeUndefined();
    expect(result.symbolIndex).toBeUndefined();
  });

  it('skips indexes when skipScan is true', async () => {
    mockedCallAI.mockResolvedValueOnce({
      choices: [{ message: { content: sampleAnalysis } }],
    });
    mockedCallAI.mockResolvedValueOnce({
      choices: [{ message: { content: samplePhase2 } }],
    });

    const result = await runAnalysisPipeline('PRD', {
      style: 'task-only',
      defaultStatus: 'todo',
      model: 'gpt-4o',
      codebasePath: '/some/path',
      skipScan: true,
    });

    // skipScan means no component discovery either
    expect(result.componentIndex).toBeUndefined();
    expect(result.symbolIndex).toBeUndefined();
    // Phase 1 should not have component index section
    const phase1UserMsg = mockedCallAI.mock.calls[0][0][1].content;
    expect(phase1UserMsg).not.toContain('=== COMPONENT INDEX ===');
  });
});
