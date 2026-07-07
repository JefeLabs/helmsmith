import { describe, expect, it } from 'vitest';
import { suggestNext } from './suggest.js';

describe('suggestNext', () => {
  it('returns empty for an unknown slug', () => {
    const result = suggestNext('nope:does:not:exist');
    expect(result).toEqual([]);
  });

  it('scores reverse-dep suggestions at the baseline weight (0.3)', () => {
    // playwright has reverse-deps (e.g. pixelmatch) but isn't wrapped by
    // any workflow that lists it directly — so all signals are
    // consumes-X at 0.3.
    const result = suggestNext('core:tools:playwright', { limit: 3 });
    expect(result.length).toBeGreaterThan(0);
    // Every suggestion is a single-signal consumes-X, so score === 0.3
    for (const s of result) {
      expect(s.score).toBeCloseTo(0.3, 5);
      expect(s.reason).toBe('consumes-X');
    }
  });

  it('scores workflow-wrapper suggestions at 0.5 above reverse-dep baselines', () => {
    // colors-select is referenced by product:greenfield (wraps-X at 0.5) AND
    // by reverse-dep tasks like scaffold/research (consumes-X at 0.3). The
    // workflow should sort first.
    const result = suggestNext('product:design:foundations:colors-select');
    expect(result.length).toBeGreaterThan(1);
    const workflow = result.find((s) => s.kind === 'workflow');
    expect(workflow).toBeDefined();
    expect(workflow!.score).toBeGreaterThanOrEqual(0.5);
    expect(workflow!.reason).toBe('wraps-X');
  });

  it('scores active-workflow positional next at 1.0', () => {
    const result = suggestNext('product:design:foundations:colors-select', {
      activeWorkflowState: {
        workflow: 'product:greenfield',
        currentStep: 'colors-select',
      },
    });
    const positional = result.find((s) => s.reason === 'next-in-active-workflow');
    expect(positional).toBeDefined();
    expect(positional!.score).toBeCloseTo(1.0, 5);
    // It should sort first (highest score)
    expect(result[0]).toBe(positional);
  });

  it('respects the limit option', () => {
    const result = suggestNext('product:strategy:scaffold', { limit: 2 });
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('sorts by score descending, workflows above commands at score ties', () => {
    const result = suggestNext('core:frameworks:heroui:components:buttons');
    for (let i = 1; i < result.length; i++) {
      const prev = result[i - 1];
      const curr = result[i];
      // Either prev has higher score, OR they tie and prev is workflow / curr is command
      // OR they tie on (score, kind) and slug ordering is alphabetical
      if (prev.score !== curr.score) {
        expect(prev.score).toBeGreaterThan(curr.score);
      } else if (prev.kind !== curr.kind) {
        expect(prev.kind).toBe('workflow');
        expect(curr.kind).toBe('command');
      } else {
        expect(prev.slug.localeCompare(curr.slug)).toBeLessThanOrEqual(0);
      }
    }
  });

  it('clamps score to [0, 1] when multiple signals fire', () => {
    const result = suggestNext('core:frameworks:heroui:components:buttons', {
      activeWorkflowState: {
        workflow: 'product:greenfield',
        currentStep: 'buttons',
      },
    });
    for (const s of result) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(1);
    }
  });
});
