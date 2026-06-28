import { describe, expect, it } from 'vitest';
import { frame, rect } from './builder.ts';

// These guard the builder-level normalizations that keep emitted .pen from
// crashing the Pencil app on click (legacy stroke shape, bare fit_content,
// explicit horizontal layout). See builder.ts for the why.

describe('frame() normalization', () => {
  it('flattens a legacy nested stroke into a Fill + sibling stroke props', () => {
    const f = frame('f', { stroke: { thickness: 2, fill: '#000000', align: 'center' } } as never);
    expect(f).toMatchObject({ stroke: '#000000', strokeWidth: 2, strokeAlignment: 'center' });
    expect((f as unknown as Record<string, unknown>).stroke).not.toHaveProperty('thickness');
  });

  it('maps stroke align inside/outside/center → inner/outer/center', () => {
    const inside = frame('a', { stroke: { thickness: 1, align: 'inside' } } as never);
    const outside = frame('b', { stroke: { thickness: 1, align: 'outside' } } as never);
    expect(inside).toMatchObject({ strokeAlignment: 'inner' });
    expect(outside).toMatchObject({ strokeAlignment: 'outer' });
  });

  it('leaves a Fill stroke (string or {type}) untouched', () => {
    expect(frame('s', { stroke: '#fff' }).stroke).toBe('#fff');
    const gradient = { type: 'gradient', stops: [] };
    expect(frame('g', { stroke: gradient } as never).stroke).toBe(gradient);
  });

  it('parenthesizes bare fit_content (bare form crashes node interaction)', () => {
    const f = frame('f', { width: 'fit_content', height: 'fit_content' } as never);
    expect(f.width).toBe('fit_content(0)');
    expect(f.height).toBe('fit_content(0)');
  });

  it('leaves fill_container and explicit sizes alone', () => {
    const f = frame('f', { width: 'fill_container', height: 240 } as never);
    expect(f.width).toBe('fill_container');
    expect(f.height).toBe(240);
  });

  it('drops explicit horizontal layout (Pencil implicit default) but keeps vertical', () => {
    expect(frame('h', { layout: 'horizontal' }).layout).toBeUndefined();
    expect(frame('v', { layout: 'vertical' }).layout).toBe('vertical');
  });
});

describe('rect() normalization', () => {
  it('applies the same stroke + fit_content normalization as frame', () => {
    const r = rect('r', { stroke: { thickness: 3, fill: '#111111' }, width: 'fit_content' } as never);
    expect(r).toMatchObject({ stroke: '#111111', strokeWidth: 3, width: 'fit_content(0)' });
  });
});