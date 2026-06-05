import { describe, expect, it } from 'vitest';
import { parseColor, toHex, TRANSPARENT } from './oklch.ts';

describe('oklch color engine', () => {
  it('round-trips oklch white/black to sRGB hex', () => {
    expect(toHex(parseColor('oklch(100% 0 0)'))).toBe('#ffffff');
    expect(toHex(parseColor('oklch(0% 0 0)'))).toBe('#000000');
  });

  it('parses HeroUI accent oklch into a plausible blue', () => {
    const hex = toHex(parseColor('oklch(0.6204 0.195 253.83)'));
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    const [, r, , g, , b] = hex;
    // accent is a blue: blue channel should dominate red.
    expect(Number.parseInt(b, 16)).toBeGreaterThan(Number.parseInt(r, 16));
  });

  it('round-trips a 6-digit hex', () => {
    expect(toHex(parseColor('#006fee'))).toBe('#006fee');
  });

  it('keeps partial alpha as 8-digit hex', () => {
    const out = toHex({ ...parseColor('#006fee'), alpha: 0.5 });
    expect(out).toMatch(/^#[0-9a-f]{8}$/);
    expect(out.endsWith('80')).toBe(true);
  });

  it('treats the transparent keyword as zero alpha', () => {
    expect(parseColor('transparent')).toEqual(TRANSPARENT);
  });
});
