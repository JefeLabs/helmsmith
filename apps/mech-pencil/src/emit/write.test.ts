import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveHeroUITokens } from '../frameworks/heroui/derive.ts';
import { emitSystem } from './system.ts';
import { type Renderer, renderSystemPngs, writeSystem } from './write.ts';

const tokens = deriveHeroUITokens().tokens;
const sys = emitSystem(tokens);

describe('writeSystem (option A, B5) — deterministic .pen emit', () => {
  it('writes every lib + base.pen, no renderer involved, zero PNGs/temps', () => {
    const out = mkdtempSync(join(tmpdir(), 'mp-write-'));
    try {
      const res = writeSystem(sys, out);

      expect(existsSync(join(out, 'foundations/colors.lib.pen'))).toBe(true);
      expect(existsSync(join(out, sys.components[0].path))).toBe(true);
      expect(existsSync(join(out, 'templates/primary-desktop.lib.pen'))).toBe(true);
      expect(existsSync(join(out, 'base.pen'))).toBe(true);
      expect(res.files).toContain('base.pen');

      // The deterministic hot path produces NO pngs and NO render temps.
      const all = readdirSync(out, { recursive: true }) as string[];
      expect(all.some((f) => f.endsWith('.png'))).toBe(false);
      expect(all.some((f) => f.endsWith('.__render.pen'))).toBe(false);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

describe('renderSystemPngs — opt-in, isolated preview render', () => {
  it('renders a PNG per visual doc and cleans up the throwaway flatten copies', () => {
    const out = mkdtempSync(join(tmpdir(), 'mp-render-'));
    try {
      const render: Renderer = (_pen, png) => {
        writeFileSync(png, 'PNG');
        return { ok: true };
      };
      const res = renderSystemPngs(sys, tokens, out, render);

      expect(existsSync(join(out, 'foundations/colors.png'))).toBe(true);
      expect(existsSync(join(out, sys.components[0].path.replace('.lib.pen', '.png')))).toBe(true);
      expect(existsSync(join(out, 'base.png'))).toBe(true);
      expect(res.skippedPngs).toHaveLength(0);
      expect(res.pngs.length).toBeGreaterThan(0);

      // throwaway flatten copies are removed
      const all = readdirSync(out, { recursive: true }) as string[];
      expect(all.some((f) => f.endsWith('.__render.pen'))).toBe(false);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('surfaces skips (not failures) when the renderer cannot produce output', () => {
    const out = mkdtempSync(join(tmpdir(), 'mp-skip-'));
    try {
      const render: Renderer = () => ({ ok: false, reason: 'not-authenticated' });
      const res = renderSystemPngs(sys, tokens, out, render);
      expect(res.pngs).toHaveLength(0);
      expect(res.skippedPngs.length).toBeGreaterThan(0);
      expect(res.skippedPngs.every((s) => s.includes('not-authenticated'))).toBe(true);
      // no half-written PNGs left behind
      const all = readdirSync(out, { recursive: true }) as string[];
      expect(all.some((f) => f.endsWith('.png'))).toBe(false);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});