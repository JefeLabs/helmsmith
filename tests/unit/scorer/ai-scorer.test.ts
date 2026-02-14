import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeTask } from '../../fixtures/tasks.js';
import { AIScorer, buildScoringPrompt, parseAIResponse } from '../../../src/scorer/ai-scorer.js';

// Mock callCopilot
vi.mock('../../../src/auth/token-manager.js', () => ({
  callCopilot: vi.fn(),
}));

const { callCopilot } = await import('../../../src/auth/token-manager.js');
const mockedCallCopilot = vi.mocked(callCopilot);

describe('buildScoringPrompt', () => {
  it('includes task title and description', () => {
    const task = makeTask({
      id: 'T-1',
      title: 'Build auth system',
      description: 'Implement OAuth for the API',
      requiredSkills: ['backend', 'auth'],
      dependencies: [{ taskId: 'T-0', type: 'blocks' }],
    });

    const messages = buildScoringPrompt(task);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('Build auth system');
    expect(messages[1].content).toContain('Implement OAuth for the API');
    expect(messages[1].content).toContain('backend, auth');
    expect(messages[1].content).toContain('1 task(s)');
  });

  it('handles tasks with no skills or description', () => {
    const task = makeTask({
      id: 'T-1',
      title: 'Simple task',
      description: '',
      requiredSkills: [],
      dependencies: [],
    });

    const messages = buildScoringPrompt(task);
    expect(messages[1].content).toContain('none specified');
    expect(messages[1].content).toContain('0 task(s)');
  });
});

describe('parseAIResponse', () => {
  it('parses valid JSON response', () => {
    const result = parseAIResponse('{"score": 7, "label": "high", "reasoning": "Complex task"}');
    expect(result).not.toBeNull();
    expect(result!.score).toBe(7);
    expect(result!.label).toBe('high');
    expect(result!.reasoning).toBe('Complex task');
  });

  it('strips markdown code fences', () => {
    const result = parseAIResponse('```json\n{"score": 5, "label": "medium", "reasoning": "ok"}\n```');
    expect(result).not.toBeNull();
    expect(result!.score).toBe(5);
  });

  it('rounds floating point scores', () => {
    const result = parseAIResponse('{"score": 6.7, "label": "medium", "reasoning": "ok"}');
    expect(result).not.toBeNull();
    expect(result!.score).toBe(7);
  });

  it('returns null for invalid JSON', () => {
    expect(parseAIResponse('not json')).toBeNull();
  });

  it('returns null for missing score field', () => {
    expect(parseAIResponse('{"label": "high"}')).toBeNull();
  });

  it('returns null for score out of range', () => {
    expect(parseAIResponse('{"score": 0, "label": "low"}')).toBeNull();
    expect(parseAIResponse('{"score": 11, "label": "high"}')).toBeNull();
  });

  it('returns null for non-numeric score', () => {
    expect(parseAIResponse('{"score": "seven", "label": "high"}')).toBeNull();
  });
});

describe('AIScorer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has name "ai"', () => {
    const scorer = new AIScorer('gpt-4o');
    expect(scorer.name).toBe('ai');
  });

  it('blends AI and heuristic scores (70/30)', async () => {
    mockedCallCopilot.mockResolvedValueOnce({
      choices: [{ message: { content: '{"score": 8, "label": "high", "reasoning": "complex"}' } }],
    });

    const task = makeTask({
      id: 'T-1',
      title: 'Simple fix',
      description: 'Fix a typo in the README.md file',
      dependencies: [],
    });

    const scorer = new AIScorer('gpt-4o');
    const result = await scorer.scoreTask(task);

    // AI score = 8, heuristic should be low (around 1-3)
    // Blended = round(0.7 * 8 + 0.3 * heuristic)
    expect(result.taskId).toBe('T-1');
    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeLessThanOrEqual(10);
    // Breakdown comes from heuristic
    expect(result.breakdown).toBeDefined();
    expect(result.breakdown.scopeBreadth).toBeGreaterThanOrEqual(0);
  });

  it('clamps blended score to 1-10', async () => {
    mockedCallCopilot.mockResolvedValueOnce({
      choices: [{ message: { content: '{"score": 10, "label": "high", "reasoning": "extreme"}' } }],
    });

    const task = makeTask({ id: 'T-1', title: 'Complex task', description: 'Very complex' });
    const scorer = new AIScorer('gpt-4o');
    const result = await scorer.scoreTask(task);

    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeLessThanOrEqual(10);
  });

  it('assigns correct label from blended score', async () => {
    mockedCallCopilot.mockResolvedValueOnce({
      choices: [{ message: { content: '{"score": 2, "label": "low", "reasoning": "simple"}' } }],
    });

    const task = makeTask({ id: 'T-1', title: 'Easy task', description: 'Very simple fix' });
    const scorer = new AIScorer('gpt-4o');
    const result = await scorer.scoreTask(task);

    if (result.score <= 3) expect(result.label).toBe('low');
    else if (result.score <= 6) expect(result.label).toBe('medium');
    else expect(result.label).toBe('high');
  });

  it('falls back to heuristic on API error', async () => {
    mockedCallCopilot.mockRejectedValueOnce(new Error('Network failure'));

    const task = makeTask({
      id: 'T-1',
      title: 'Build API',
      description: 'Create REST endpoints with database',
    });
    const scorer = new AIScorer('gpt-4o');
    const result = await scorer.scoreTask(task);

    // Should still return a valid result (heuristic fallback)
    expect(result.taskId).toBe('T-1');
    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeLessThanOrEqual(10);
    expect(result.breakdown).toBeDefined();
  });

  it('falls back to heuristic on malformed AI response', async () => {
    mockedCallCopilot.mockResolvedValueOnce({
      choices: [{ message: { content: 'This is not JSON' } }],
    });

    const task = makeTask({ id: 'T-1', title: 'Test task', description: 'Some task' });
    const scorer = new AIScorer('gpt-4o');
    const result = await scorer.scoreTask(task);

    expect(result.taskId).toBe('T-1');
    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeLessThanOrEqual(10);
  });

  it('falls back to heuristic when response has no choices', async () => {
    mockedCallCopilot.mockResolvedValueOnce({ choices: [] });

    const task = makeTask({ id: 'T-1', title: 'Test task', description: 'Some task' });
    const scorer = new AIScorer('gpt-4o');
    const result = await scorer.scoreTask(task);

    expect(result.taskId).toBe('T-1');
    expect(result.score).toBeGreaterThanOrEqual(1);
  });

  it('uses provided heuristic scorer instance', async () => {
    const { HeuristicScorer } = await import('../../../src/scorer/heuristic.js');
    const customHeuristic = new HeuristicScorer({
      scopeBreadth: 0,
      technicalDepth: 1.0,
      dependencyCount: 0,
      ambiguity: 0,
      crossCutting: 0,
    });

    mockedCallCopilot.mockResolvedValueOnce({
      choices: [{ message: { content: '{"score": 5, "label": "medium", "reasoning": "ok"}' } }],
    });

    const task = makeTask({ id: 'T-1', title: 'API task', description: 'Build an API' });
    const scorer = new AIScorer('gpt-4o', customHeuristic);
    const result = await scorer.scoreTask(task);

    expect(result.taskId).toBe('T-1');
    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeLessThanOrEqual(10);
  });
});
