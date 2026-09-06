import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InvalidArgumentError } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InstanceRecord } from '../../types.js';
import {
  parseIntegerInRange,
  parseNonNegativeNumber,
  printInstance,
  printInstanceTable,
  resolveComponent,
} from './output.js';

const rec: InstanceRecord = {
  id: 'abc',
  hostRoot: '/h',
  component: 'src/Button',
  framework: '@storybook/react-vite',
  port: 6100,
  url: 'http://127.0.0.1:6100',
  pid: 1,
  status: 'ready',
  createdAt: 'c',
  lastTouchedAt: 't',
  ttlMinutes: 30,
  storyFiles: ['src/Button/Button.stories.tsx'],
  stories: [
    {
      id: 'button--primary',
      title: 'Button',
      name: 'Primary',
      importPath: './src/Button/Button.stories.tsx',
      url: 'http://127.0.0.1:6100/?path=/story/button--primary',
      iframeUrl: 'http://127.0.0.1:6100/iframe.html?id=button--primary&viewMode=story',
    },
  ],
  configDir: '/h/node_modules/.cache/storybrokr/abc',
};

describe('output', () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('prints a table row per instance and a detail block with one line per story', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    printInstanceTable([rec]);
    const table = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(table).toMatch(/abc/);
    expect(table).toMatch(/src\/Button/);
    expect(table).toMatch(/ready/);
    log.mockClear();
    printInstance(rec);
    const detail = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(detail).toContain('http://127.0.0.1:6100');
    expect(detail).toContain('button--primary');
    expect(detail).toContain('iframe.html?id=button--primary');
  });

  it('resolveComponent turns any path into a host-relative component', () => {
    const root = mkdtempSync(join(tmpdir(), 'sb-out-'));
    dirs.push(root);
    mkdirSync(join(root, '.storybook'));
    writeFileSync(join(root, '.storybook', 'main.ts'), 'export default {};\n');
    mkdirSync(join(root, 'src', 'Button'), { recursive: true });
    expect(resolveComponent(join(root, 'src', 'Button'))).toEqual({
      component: 'src/Button',
      hostRoot: root,
    });
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(join(root, 'src'));
    expect(resolveComponent('Button')).toEqual({ component: 'src/Button', hostRoot: root });
    cwd.mockRestore();
  });

  it('parseNonNegativeNumber accepts finite numbers >= 0 (fractions allowed) and rejects the rest', () => {
    expect(parseNonNegativeNumber('0.02')).toBe(0.02);
    expect(parseNonNegativeNumber('5')).toBe(5);
    expect(() => parseNonNegativeNumber('abc')).toThrow(InvalidArgumentError);
    expect(() => parseNonNegativeNumber('-1')).toThrow(InvalidArgumentError);
  });

  it('parseIntegerInRange accepts an integer within range and rejects out-of-range, fractional, or non-numeric input', () => {
    const parse = parseIntegerInRange(1, 2000);
    expect(parse('200')).toBe(200);
    expect(() => parse('0')).toThrow(InvalidArgumentError);
    expect(() => parse('1.5')).toThrow(InvalidArgumentError);
    expect(() => parse('abc')).toThrow(InvalidArgumentError);
  });
});
