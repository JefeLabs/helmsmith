import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostInfo, InstanceRecord } from '../types.js';
import {
  configDirFor,
  generateConfigDir,
  instanceId,
  readSidecars,
  removeConfigDir,
  writeSidecar,
} from './instance.js';

function fakeHost(previewExt = 'js', withManager = false): HostInfo {
  const hostRoot = mkdtempSync(join(tmpdir(), 'sb-inst-'));
  mkdirSync(join(hostRoot, '.storybook'));
  writeFileSync(join(hostRoot, '.storybook', 'main.ts'), 'export default {};\n');
  writeFileSync(join(hostRoot, '.storybook', `preview.${previewExt}`), 'export default {};\n');
  if (withManager) writeFileSync(join(hostRoot, '.storybook', 'manager.ts'), '');
  return {
    hostRoot,
    storybookDir: join(hostRoot, '.storybook'),
    mainFile: join(hostRoot, '.storybook', 'main.ts'),
    previewFile: join(hostRoot, '.storybook', `preview.${previewExt}`),
    managerFile: withManager ? join(hostRoot, '.storybook', 'manager.ts') : null,
    framework: '@storybook/nextjs',
    storybookBin: join(hostRoot, 'node_modules', '.bin', 'storybook'),
    storybookVersion: '10.6.0',
    tsconfigPaths: {},
  };
}

describe('instance config dir', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });

  it('derives a stable 12-char id from host + component', () => {
    const a = instanceId('/h', 'src/Button');
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(instanceId('/h', 'src/Button')).toBe(a);
    expect(instanceId('/h', 'src/Other')).not.toBe(a);
  });

  it('writes main.ts that imports the host main and overrides stories, staticDirs and nextConfigPath', () => {
    const host = fakeHost();
    roots.push(host.hostRoot);
    const dir = generateConfigDir(host, 'abc123abc123', [
      'src/Button.stories.tsx',
      'src/Icon.stories.tsx',
    ]);
    expect(dir).toBe(configDirFor(host.hostRoot, 'abc123abc123'));
    expect(dir).toBe(join(host.hostRoot, 'node_modules', '.cache', 'storybrokr', 'abc123abc123'));
    const main = readFileSync(join(dir, 'main.ts'), 'utf8');
    expect(main).toContain(`import host from ${JSON.stringify(host.mainFile)};`);
    expect(main).toContain("import { resolve as pathResolve } from 'node:path';");
    expect(main).not.toContain('require(');
    expect(main).toContain('"../../../../src/Button.stories.tsx"');
    expect(main).toContain('"../../../../src/Icon.stories.tsx"');
    expect(main).toContain('staticDirs');
    expect(main).toContain('nextConfigPath');
    expect(main).toContain('export default config;');
  });

  it('re-exports the host preview with its own extension and only writes manager when the host has one', () => {
    const host = fakeHost('tsx', true);
    roots.push(host.hostRoot);
    const dir = generateConfigDir(host, 'abc123abc123', ['src/A.stories.tsx']);
    const preview = readFileSync(join(dir, 'preview.tsx'), 'utf8');
    expect(preview).toContain(`export * from ${JSON.stringify(host.previewFile)};`);
    expect(preview).toContain(`export { default } from ${JSON.stringify(host.previewFile)};`);
    expect(existsSync(join(dir, 'manager.ts'))).toBe(true);
    const noManager = fakeHost();
    roots.push(noManager.hostRoot);
    const dir2 = generateConfigDir(noManager, 'abc123abc123', ['src/A.stories.tsx']);
    expect(existsSync(join(dir2, 'manager.ts'))).toBe(false);
  });

  it('round-trips sidecars and removes the dir', () => {
    const host = fakeHost();
    roots.push(host.hostRoot);
    const dir = generateConfigDir(host, 'abc123abc123', ['src/A.stories.tsx']);
    const record = {
      id: 'abc123abc123',
      hostRoot: host.hostRoot,
      component: 'src',
      framework: '@storybook/nextjs',
      port: 6100,
      url: 'http://127.0.0.1:6100',
      pid: null,
      status: 'starting',
      createdAt: '2026-09-06T00:00:00.000Z',
      lastTouchedAt: '2026-09-06T00:00:00.000Z',
      ttlMinutes: 30,
      storyFiles: ['src/A.stories.tsx'],
      stories: [],
      configDir: dir,
    } satisfies InstanceRecord;
    writeSidecar(dir, record);
    expect(readSidecars(host.hostRoot)).toEqual([record]);
    removeConfigDir(dir);
    expect(existsSync(dir)).toBe(false);
    expect(readSidecars(host.hostRoot)).toEqual([]);
  });
});
