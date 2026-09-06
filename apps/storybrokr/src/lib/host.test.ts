import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StorybrokrError } from './errors.js';
import { detectFramework, findHostRoot, inspectHost, resolveHost } from './host.js';

/** Minimal fake host: .storybook/main.ts + preview.js + storybook bin + version. */
function makeHost(
  opts: { framework?: string; preview?: boolean; bin?: boolean; version?: string } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'sb-host-'));
  mkdirSync(join(root, '.storybook'));
  const framework = opts.framework ?? '@storybook/react-vite';
  writeFileSync(
    join(root, '.storybook', 'main.ts'),
    `export default { framework: { name: '${framework}', options: {} }, stories: ['../src/**/*.stories.tsx'] };\n`,
  );
  if (opts.preview !== false)
    writeFileSync(join(root, '.storybook', 'preview.js'), 'export default {};\n');
  if (opts.bin !== false) {
    mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
    writeFileSync(join(root, 'node_modules', '.bin', 'storybook'), '#!/bin/sh\n');
    chmodSync(join(root, 'node_modules', '.bin', 'storybook'), 0o755);
    mkdirSync(join(root, 'node_modules', 'storybook'), { recursive: true });
    writeFileSync(
      join(root, 'node_modules', 'storybook', 'package.json'),
      JSON.stringify({ version: opts.version ?? '10.6.0' }),
    );
  }
  mkdirSync(join(root, 'src', 'components', 'button'), { recursive: true });
  return root;
}

describe('host', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('findHostRoot walks up to the directory containing .storybook', () => {
    const root = makeHost();
    dirs.push(root);
    expect(findHostRoot(join(root, 'src', 'components', 'button'))).toBe(root);
    expect(findHostRoot(root)).toBe(root);
  });

  it('findHostRoot returns null when nothing above has .storybook', () => {
    const d = mkdtempSync(join(tmpdir(), 'sb-nohost-'));
    dirs.push(d);
    expect(findHostRoot(d)).toBeNull();
  });

  it('inspectHost reports main, preview, framework, bin, version and paths', () => {
    const root = makeHost();
    dirs.push(root);
    writeFileSync(join(root, 'tsconfig.json'), '{"compilerOptions":{"paths":{"@/*":["./src/*"]}}}');
    const info = inspectHost(root);
    expect(info.hostRoot).toBe(root);
    expect(info.mainFile).toBe(join(root, '.storybook', 'main.ts'));
    expect(info.previewFile).toBe(join(root, '.storybook', 'preview.js'));
    expect(info.managerFile).toBeNull();
    expect(info.framework).toBe('@storybook/react-vite');
    expect(info.storybookBin).toBe(join(root, 'node_modules', '.bin', 'storybook'));
    expect(info.storybookVersion).toBe('10.6.0');
    expect(info.tsconfigPaths).toEqual({ '@/*': ['./src/*'] });
  });

  it('inspectHost throws HOST_INVALID naming the missing storybook binary', () => {
    const root = makeHost({ bin: false });
    dirs.push(root);
    expect(() => inspectHost(root)).toThrow(StorybrokrError);
    try {
      inspectHost(root);
    } catch (e) {
      expect((e as StorybrokrError).code).toBe('HOST_INVALID');
      expect((e as StorybrokrError).message).toMatch(/node_modules\/\.bin\/storybook/);
    }
  });

  it('resolveHost throws HOST_NOT_FOUND for a path with no .storybook above it', () => {
    const d = mkdtempSync(join(tmpdir(), 'sb-nohost-'));
    dirs.push(d);
    expect(() => resolveHost(join(d, 'x'))).toThrow(/HOST_NOT_FOUND|no \.storybook/);
  });

  it('resolveHost prefers an explicit host root', () => {
    const root = makeHost();
    dirs.push(root);
    expect(resolveHost('components/button', root).hostRoot).toBe(root);
  });

  it('inspectHost throws HOST_INVALID for storybook version below 7', () => {
    const root = makeHost({ version: '6.5.16' });
    dirs.push(root);
    expect(() => inspectHost(root)).toThrow(StorybrokrError);
    try {
      inspectHost(root);
    } catch (e) {
      expect((e as StorybrokrError).code).toBe('HOST_INVALID');
      expect((e as StorybrokrError).message).toMatch(/6\.5\.16/);
      expect((e as StorybrokrError).message).toMatch(/7 or newer/);
    }
  });

  it('detectFramework handles string form and helper form with digits', () => {
    expect(detectFramework("framework: '@storybook/react-vite'")).toBe('@storybook/react-vite');
    expect(
      detectFramework(
        "framework: { name: getAbsolutePath('@storybook/react-webpack5'), options: {} }",
      ),
    ).toBe('@storybook/react-webpack5');
  });
});
