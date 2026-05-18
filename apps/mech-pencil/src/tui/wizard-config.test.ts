import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, RADIUS_IDS } from '../theme/config.ts';
import {
  cycle,
  FONT_OPTIONS,
  finalizeTheme,
  getField,
  initialDraft,
  setField,
  THEME_FIELDS,
  themeToBundleOptions,
} from './wizard-config.ts';

describe('initialDraft', () => {
  it('seeds every field from the HeroUI default theme', () => {
    const d = initialDraft();
    expect(d.accent).toBe(DEFAULT_THEME.accent);
    expect(Number(d.base)).toBe(DEFAULT_THEME.base);
    expect(d.fontFamily).toBe(DEFAULT_THEME.fontFamily);
    expect(d.radius).toBe(DEFAULT_THEME.radius);
  });
});

describe('getField / setField', () => {
  it('returns an updated copy without mutating the original', () => {
    const a = initialDraft();
    const b = setField(a, 'accent', '#ff0000');
    expect(getField(b, 'accent')).toBe('#ff0000');
    expect(getField(a, 'accent')).toBe(DEFAULT_THEME.accent);
  });
});

describe('cycle', () => {
  it('steps forward and wraps past the end', () => {
    expect(cycle(RADIUS_IDS, RADIUS_IDS[0] as string, 1)).toBe(RADIUS_IDS[1]);
    expect(cycle(RADIUS_IDS, RADIUS_IDS[RADIUS_IDS.length - 1] as string, 1)).toBe(RADIUS_IDS[0]);
  });
  it('steps backward and wraps past the start', () => {
    expect(cycle(FONT_OPTIONS, FONT_OPTIONS[0], -1)).toBe(FONT_OPTIONS[FONT_OPTIONS.length - 1]);
  });
  it('treats an unknown current value as index 0', () => {
    expect(cycle(FONT_OPTIONS, 'Comic Sans', 1)).toBe(FONT_OPTIONS[1]);
  });
});

describe('THEME_FIELDS', () => {
  it('marks accent/base as text and the three radius/font fields as enum', () => {
    const kinds = Object.fromEntries(THEME_FIELDS.map((f) => [f.id, f.kind]));
    expect(kinds.accent).toBe('text');
    expect(kinds.base).toBe('text');
    expect(kinds.fontFamily).toBe('enum');
    expect(kinds.radius).toBe('enum');
    expect(kinds.formRadius).toBe('enum');
  });
  it('gives every enum field a non-empty options list', () => {
    for (const f of THEME_FIELDS.filter((x) => x.kind === 'enum')) {
      expect(f.options?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe('finalizeTheme → themeToBundleOptions', () => {
  it('produces BundleCmdOptions targeting the current dir with stringified base', () => {
    const opts = themeToBundleOptions('heroui', finalizeTheme(initialDraft()));
    expect(opts.dir).toBe('.');
    expect(opts.accent).toBe(DEFAULT_THEME.accent);
    expect(opts.base).toBe(String(DEFAULT_THEME.base));
    expect(opts.radius).toBe(DEFAULT_THEME.radius);
  });

  it('carries an explicit accent/font through the pipeline', () => {
    const draft = setField(setField(initialDraft(), 'accent', '#3b82f6'), 'fontFamily', 'Geist');
    const opts = themeToBundleOptions('heroui-pro', finalizeTheme(draft));
    expect(opts.accent).toBe('#3b82f6');
    expect(opts.font).toBe('Geist');
  });
});

describe('validateField (your contribution)', () => {
  // Fill these in alongside your validateField policy. Examples of the
  // contract to pin, depending on the decisions you make:
  //   - a clearly valid accent (e.g. '#3b82f6') returns null
  //   - obvious garbage (e.g. 'notacolor') returns a non-null message
  //   - 'base' outside your accepted range returns a message
  it.todo('accepts a well-formed accent color');
  it.todo('rejects an unparseable accent with an inline message');
  it.todo('enforces the chosen base-value policy');
});
