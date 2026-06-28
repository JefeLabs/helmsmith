import { describe, expect, it } from 'vitest';
import { reactName } from '../frameworks/heroui/catalog.ts';
import { assertBrandFile } from './schema.ts';
import { brandToTokens } from './to-tokens.ts';

const brand = {
  statusColors: { success: '#2f9e6e' },
  colorRamps: {
    accent: { '100': '#dde3f1', '500': '#3f5694' },
    neutral: { '50': '#f6f7f9', '500': '#6b7385', '900': '#1c2129' },
  },
  fonts: { family: 'Satoshi' },
  sizes: { 'radius.md': 10 },
};

describe('brandToTokens', () => {
  it('maps ramps onto concrete semantic colors components bind to', () => {
    const { variables } = brandToTokens(brand);
    expect(variables['color.accent']).toEqual({ type: 'color', value: '#3f5694' });
    expect(variables['color.accent-soft']).toEqual({ type: 'color', value: '#dde3f1' });
    expect(variables['color.background']).toEqual({ type: 'color', value: '#f6f7f9' });
    expect(variables['color.muted']).toEqual({ type: 'color', value: '#6b7385' });
  });

  it('emits raw ramp + status vars and respects size/font overrides', () => {
    const { variables } = brandToTokens(brand);
    expect(variables['accent.500']).toEqual({ type: 'color', value: '#3f5694' });
    expect(variables['status.success']).toEqual({ type: 'color', value: '#2f9e6e' });
    expect(variables['radius.md']).toEqual({ type: 'number', value: 10 });
    expect(variables['font.family']).toEqual({ type: 'string', value: 'Satoshi' });
  });

  it('falls back to defaults when ramps/sizes are absent', () => {
    const { variables } = brandToTokens({ statusColors: { info: '#3a72b8' } });
    expect(variables['color.accent'].value).toBe('#3f5694'); // fallback
    expect(variables['radius.md']).toEqual({ type: 'number', value: 8 });
  });

  it('assertBrandFile rejects empty / non-object input', () => {
    expect(() => assertBrandFile(null)).toThrow();
    expect(() => assertBrandFile({})).toThrow();
    expect(() => assertBrandFile(brand)).not.toThrow();
  });
});

describe('reactName', () => {
  it('produces canonical HeroUI React export names', () => {
    expect(reactName('button')).toBe('Button');
    expect(reactName('list-box')).toBe('ListBox');
    expect(reactName('date-range-picker')).toBe('DateRangePicker');
    expect(reactName('input-otp')).toBe('InputOTP');
  });
});
