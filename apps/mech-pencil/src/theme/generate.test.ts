import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, resolveTheme } from './config.ts';
import { themeTokens } from './generate.ts';

const get = (r: ReturnType<typeof themeTokens>, key: string) =>
  r.tokens.colors.find((c) => c.key === key);
const scalar = (r: ReturnType<typeof themeTokens>, key: string) =>
  r.tokens.scalars.find((s) => s.key === key)?.value;

describe('resolveTheme', () => {
  it('fills defaults and validates radius enums', () => {
    expect(resolveTheme({})).toEqual(DEFAULT_THEME);
    expect(() => resolveTheme({ radius: 'huge' as never })).toThrow(/invalid radius/);
    expect(() => resolveTheme({ base: -1 })).toThrow(/base must be/);
  });
  it('maps font ids to display names', () => {
    expect(resolveTheme({ fontFamily: 'instrument-sans' }).fontFamily).toBe('Instrument Sans');
  });
});

describe('themeTokens', () => {
  it('emits the full semantic + derived palette as static hex', () => {
    const r = themeTokens(resolveTheme({ accent: '#3f5694' }));
    const accent = get(r, 'color.accent');
    expect(accent?.values.light).toMatch(/^#[0-9a-f]{6}$/);
    // accent round-trips close to the input #3f5694 (OKLCH→sRGB)
    expect(accent?.values.light?.startsWith('#3')).toBe(true);
    // derived layer present
    expect(get(r, 'color.accent-soft')).toBeTruthy();
    expect(get(r, 'color.surface-hover')).toBeTruthy();
    expect(r.derivedResolved).toBe(true);
  });

  it('radius preset drives the radius scale', () => {
    const none = themeTokens(resolveTheme({ radius: 'none' }));
    const xs = themeTokens(resolveTheme({ radius: 'extra-small' }));
    const lg = themeTokens(resolveTheme({ radius: 'large' }));
    expect(scalar(none, 'radius.md')).toBe(0);
    // extra-small = 0.125rem → md = 0.125*0.75*16 ≈ 2 (rounded)
    expect(scalar(xs, 'radius.md')).toBe(2);
    // large = 0.75rem → lg = 0.75*1*16 = 12
    expect(scalar(lg, 'radius.lg')).toBe(12);
  });

  it('form-radius drives radius.field independently', () => {
    const t = themeTokens(resolveTheme({ radius: 'none', formRadius: 'large' }));
    expect(scalar(t, 'radius.md')).toBe(0);
    expect(scalar(t, 'radius.field')).toBe(12);
  });

  it('accent hue rotates the neutrals (warm accent → warm-tinted bg)', () => {
    const warm = themeTokens(resolveTheme({ accent: 'oklch(62% 0.2 30)', base: 0.02 }));
    const cool = themeTokens(resolveTheme({ accent: 'oklch(62% 0.2 250)', base: 0.02 }));
    // background differs purely from accent-hue rotation of the tint
    expect(get(warm, 'color.background')?.values.light).not.toBe(
      get(cool, 'color.background')?.values.light,
    );
  });
});
