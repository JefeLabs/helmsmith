import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveHeroUITokens } from '../frameworks/heroui/derive.ts';
import { emitSystem } from './system.ts';
import { type Renderer, writeSystem } from './write.ts';

const tokens = deriveHeroUITokens().tokens;
const sys = emitSystem(tokens);

describe('writeSystem (option A, B5)', () => {
  it('emit .pen → png → rename .lib.pen when the renderer succeeds', () => {
    const out = mkdtempSync(join(tmpdir(), 'mp-ok-'));
    try {
      const render: Renderer = (_pen, png) => {
        writeFileSync(png, 'PNG');
        return { ok: true };
      };
      const res = writeSystem(sys, tokens, out, render);

      // foundation: token lib written, decision-page PNG rendered, page .pen dropped
      expect(existsSync(join(out, 'foundations/colors.lib.pen'))).toBe(true);
      expect(existsSync(join(out, 'foundations/colors.png'))).toBe(true);
      expect(existsSync(join(out, 'foundations/colors.preview.pen'))).toBe(false);

      // component: renamed to .lib.pen, intermediate .pen gone, png present
      const comp = sys.components[0].path;
      expect(existsSync(join(out, comp))).toBe(true);
      expect(existsSync(join(out, comp.replace('.lib.pen', '.pen')))).toBe(false);
      expect(existsSync(join(out, comp.replace('.lib.pen', '.png')))).toBe(true);

      // template: renamed to .lib.pen; base stays .pen + base.png
      expect(existsSync(join(out, 'templates/primary-desktop.lib.pen'))).toBe(true);
      expect(existsSync(join(out, 'base.pen'))).toBe(true);
      expect(existsSync(join(out, 'base.png'))).toBe(true);

      expect(res.skippedPngs).toHaveLength(0);
      expect(res.pngs.length).toBeGreaterThan(0);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('still emits every lib when unauthenticated (PNGs skipped, not fatal)', () => {
    const out = mkdtempSync(join(tmpdir(), 'mp-noauth-'));
    try {
      const render: Renderer = () => ({ ok: false, reason: 'not-authenticated' });
      const res = writeSystem(sys, tokens, out, render);
      expect(existsSync(join(out, 'foundations/colors.lib.pen'))).toBe(true);
      expect(existsSync(join(out, 'templates/primary-desktop.lib.pen'))).toBe(true);
      expect(existsSync(join(out, 'base.pen'))).toBe(true);
      expect(res.pngs).toHaveLength(0);
      expect(res.skippedPngs.length).toBeGreaterThan(0);
      expect(res.skippedPngs.every((s) => s.includes('not-authenticated'))).toBe(true);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});