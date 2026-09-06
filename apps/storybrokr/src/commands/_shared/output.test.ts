import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InstanceRecord } from '../../types.js';
import { printInstance, printInstanceTable, resolveComponent } from './output.js';

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
    mkdirSync(join(root, 'src', 'Button'), { recursive: true });
    expect(resolveComponent(join(root, 'src', 'Button'))).toEqual({
      component: 'src/Button',
      hostRoot: root,
    });
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(join(root, 'src'));
    expect(resolveComponent('Button')).toEqual({ component: 'src/Button', hostRoot: root });
    cwd.mockRestore();
  });
});
