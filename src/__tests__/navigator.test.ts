import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runNavigator } from '../views/navigator.js';
import type { ViewContext, ViewFn, NavigationAction } from '../views/types.js';
import type { Config } from '../types/schema.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCtx(): ViewContext {
  const config: Config = {
    repos: [],
    orgs: [],
    groups: {},
    tags: {},
    settings: { weeks_back: 12, staleness_minutes: 60, trend_threshold: 0.10 },
  };
  return { config, records: [], currentWeek: '2026-W09' };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('runNavigator', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('exits immediately on quit action', async () => {
    const ctx = makeCtx();
    const view: ViewFn = vi.fn(async () => ({ type: 'quit' as const }));

    await runNavigator(view, ctx);

    expect(view).toHaveBeenCalledTimes(1);
    expect(view).toHaveBeenCalledWith(ctx);
  });

  it('pushes a view onto the stack', async () => {
    const ctx = makeCtx();
    const callOrder: string[] = [];

    const childView: ViewFn = vi.fn(async () => {
      callOrder.push('child');
      return { type: 'quit' as const };
    });

    const parentView: ViewFn = vi.fn(async () => {
      callOrder.push('parent');
      return { type: 'push' as const, view: childView };
    });

    await runNavigator(parentView, ctx);

    expect(callOrder).toEqual(['parent', 'child']);
    expect(parentView).toHaveBeenCalledTimes(1);
    expect(childView).toHaveBeenCalledTimes(1);
  });

  it('pops back to the previous view', async () => {
    const ctx = makeCtx();
    let parentCallCount = 0;

    const childView: ViewFn = async () => ({ type: 'pop' as const });

    const parentView: ViewFn = async () => {
      parentCallCount++;
      if (parentCallCount === 1) {
        return { type: 'push' as const, view: childView };
      }
      return { type: 'quit' as const };
    };

    await runNavigator(parentView, ctx);

    // parent called twice: first push, then quit after child pops
    expect(parentCallCount).toBe(2);
  });

  it('replaces the current view on the stack', async () => {
    const ctx = makeCtx();

    const replacementView: ViewFn = vi.fn(async () => ({
      type: 'quit' as const,
    }));

    const initialView: ViewFn = vi.fn(async () => ({
      type: 'replace' as const,
      view: replacementView,
    }));

    await runNavigator(initialView, ctx);

    expect(initialView).toHaveBeenCalledTimes(1);
    expect(replacementView).toHaveBeenCalledTimes(1);
  });

  it('exits when stack empties via pop', async () => {
    const ctx = makeCtx();

    const view: ViewFn = vi.fn(async () => ({ type: 'pop' as const }));

    await runNavigator(view, ctx);

    // View called once, then popped -> stack empty -> exit
    expect(view).toHaveBeenCalledTimes(1);
  });

  it('handles errors by logging and exiting', async () => {
    const ctx = makeCtx();
    const error = new Error('test error');

    const view: ViewFn = vi.fn(async () => {
      throw error;
    });

    await runNavigator(view, ctx);

    expect(consoleErrorSpy).toHaveBeenCalledWith('View error:', error);
  });

  it('supports multi-level push/pop navigation', async () => {
    const ctx = makeCtx();
    const callOrder: string[] = [];
    let level1Calls = 0;
    let level2Calls = 0;

    const level3: ViewFn = async () => {
      callOrder.push('level3');
      return { type: 'pop' as const };
    };

    const level2: ViewFn = async () => {
      level2Calls++;
      callOrder.push('level2');
      if (level2Calls === 1) {
        return { type: 'push' as const, view: level3 };
      }
      return { type: 'pop' as const };
    };

    const level1: ViewFn = async () => {
      level1Calls++;
      callOrder.push('level1');
      if (level1Calls === 1) {
        return { type: 'push' as const, view: level2 };
      }
      return { type: 'quit' as const };
    };

    await runNavigator(level1, ctx);

    // level1 -> push level2 -> push level3 -> pop to level2 -> pop to level1 -> quit
    expect(callOrder).toEqual([
      'level1',
      'level2',
      'level3',
      'level2',
      'level1',
    ]);
  });

  it('replace does not grow the stack', async () => {
    const ctx = makeCtx();
    let replaceCount = 0;

    const viewA: ViewFn = async () => {
      replaceCount++;
      if (replaceCount <= 3) {
        // keep replacing with self
        return { type: 'replace' as const, view: viewA };
      }
      return { type: 'quit' as const };
    };

    await runNavigator(viewA, ctx);

    // Should have been called 4 times (3 replaces + 1 quit)
    expect(replaceCount).toBe(4);
  });
});
