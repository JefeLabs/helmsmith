import { describe, expect, it } from 'vitest';
import { buildManifest } from './build.ts';

describe('buildManifest', () => {
  const m = buildManifest();

  it('indexes all 71 components with React mapping', () => {
    expect(m.componentCount).toBe(71);
    expect(m.framework).toBe('heroui');
    expect(m.package).toBe('@heroui/react');
    expect(m.pencilVersion).toBe('2.13');
    const byId = Object.fromEntries(m.components.map((c) => [c.id, c]));
    expect(byId['list-box'].react).toBe('ListBox');
    expect(byId['date-range-picker'].react).toBe('DateRangePicker');
    expect(byId['input-otp'].react).toBe('InputOTP');
  });

  it('exposes the customizable descendants surface', () => {
    const byId = Object.fromEntries(m.components.map((c) => [c.id, c]));
    const cardParts = byId.card.customizable.map((p) => p.id);
    expect(cardParts).toContain('card-title');
    expect(cardParts).toContain('card-subtitle');
    const title = byId.card.customizable.find((p) => p.id === 'card-title');
    expect(title?.overrides).toContain('content');
    const btnLabel = byId.button.customizable.find((p) => p.id === 'button-label');
    expect(btnLabel?.overrides).toContain('content');
    // no part id contains a slash (descendants keys are flat ids)
    expect(m.components.every((c) => c.customizable.every((p) => !p.id.includes('/')))).toBe(true);
  });

  it('carries the token contract and the verified constraints', () => {
    expect(m.tokens.some((t) => t.key === 'color.accent' && t.type === 'color')).toBe(true);
    expect(m.tokens.some((t) => t.key === 'radius.md' && t.type === 'number')).toBe(true);
    expect(m.components.find((c) => c.id === 'button')?.tokens).toContain('color.accent');
    // the negative knowledge must be present (it's the highest-value part)
    const joined = m.constraints.join(' ');
    expect(joined).toMatch(/descendants.*dropped/i);
    expect(joined).toMatch(/lib\.pen.*standalone|standalone.*resolve/i);
    expect(m.commands.bundle).toBeTruthy();
  });
});
