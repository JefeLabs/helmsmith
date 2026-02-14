import { describe, it, expect, vi } from 'vitest';
import { makeTask } from '../../fixtures/tasks.js';
import { createScorer, AIScorer, HeuristicScorer } from '../../../src/scorer/index.js';

describe('createScorer', () => {
  it('returns AIScorer when authAvailable is true', () => {
    const scorer = createScorer('gpt-4o', true);
    expect(scorer).toBeInstanceOf(AIScorer);
    expect(scorer.name).toBe('ai');
  });

  it('returns HeuristicScorer when authAvailable is false', () => {
    const scorer = createScorer('gpt-4o', false);
    expect(scorer).toBeInstanceOf(HeuristicScorer);
    expect(scorer.name).toBe('heuristic');
  });
});

describe('scorer pipeline integration', () => {
  it('HeuristicScorer scores tasks without any API calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const scorer = createScorer('gpt-4o', false);

    const task = makeTask({
      id: 'T-1',
      title: 'Build authentication system',
      description: 'Implement OAuth with token management',
    });

    const result = await scorer.scoreTask(task);

    expect(result.taskId).toBe('T-1');
    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeLessThanOrEqual(10);
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it('AIScorer falls back gracefully when callCopilot fails', async () => {
    // Mock callCopilot to fail
    vi.doMock('../../../src/auth/token-manager.js', () => ({
      callCopilot: vi.fn().mockRejectedValue(new Error('Network error')),
    }));

    // Re-import to get mocked version
    const { AIScorer: MockedAIScorer } = await import('../../../src/scorer/ai-scorer.js');

    const task = makeTask({
      id: 'T-2',
      title: 'Complex task',
      description: 'A complex task with database, API, and auth concerns',
    });

    const scorer = new MockedAIScorer('gpt-4o');
    const result = await scorer.scoreTask(task);

    // Should still get a valid result from heuristic fallback
    expect(result.taskId).toBe('T-2');
    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeLessThanOrEqual(10);
    expect(result.breakdown).toBeDefined();

    vi.doUnmock('../../../src/auth/token-manager.js');
  });
});
