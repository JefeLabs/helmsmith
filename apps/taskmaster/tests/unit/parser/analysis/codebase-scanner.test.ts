import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  formatScanForPrompt,
  scanCodebase,
} from '../../../../src/parser/analysis/codebase-scanner.js';

describe('scanCodebase', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'scanner-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('scans a directory and returns file counts', async () => {
    writeFileSync(join(tempDir, 'index.ts'), 'export const x = 1;');
    writeFileSync(join(tempDir, 'app.tsx'), '<App />');
    writeFileSync(join(tempDir, 'readme.md'), '# Hello');

    const result = await scanCodebase(tempDir);

    expect(result.totalFiles).toBe(3);
    expect(result.fileExtensions['.ts']).toBe(1);
    expect(result.fileExtensions['.tsx']).toBe(1);
    expect(result.fileExtensions['.md']).toBe(1);
  });

  it('skips node_modules and .git directories', async () => {
    mkdirSync(join(tempDir, 'node_modules'));
    writeFileSync(join(tempDir, 'node_modules', 'hidden.js'), 'x');
    mkdirSync(join(tempDir, '.git'));
    writeFileSync(join(tempDir, '.git', 'HEAD'), 'ref');
    writeFileSync(join(tempDir, 'visible.ts'), 'x');

    const result = await scanCodebase(tempDir);

    expect(result.totalFiles).toBe(1);
    expect(result.directoryTree).not.toContain('node_modules');
    expect(result.directoryTree).not.toContain('.git');
  });

  it('reads package.json and extracts relevant fields', async () => {
    const pkg = {
      name: 'test-app',
      version: '1.0.0',
      dependencies: { express: '^4.18.0' },
      devDependencies: { vitest: '^1.0.0' },
      scripts: { test: 'vitest', build: 'tsc' },
      description: 'This should not appear',
    };
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify(pkg));

    const result = await scanCodebase(tempDir);

    expect(result.manifestContents['package.json']).toBeDefined();
    const parsed = JSON.parse(result.manifestContents['package.json']);
    expect(parsed.name).toBe('test-app');
    expect(parsed.dependencies).toEqual({ express: '^4.18.0' });
    expect(parsed.scripts).toEqual(['test', 'build']);
    expect(parsed.description).toBeUndefined(); // Not extracted
  });

  it('detects typescript pattern from file extensions', async () => {
    writeFileSync(join(tempDir, 'index.ts'), 'x');

    const result = await scanCodebase(tempDir);

    expect(result.detectedPatterns).toContain('typescript');
  });

  it('detects docker pattern', async () => {
    writeFileSync(join(tempDir, 'Dockerfile'), 'FROM node:20');

    const result = await scanCodebase(tempDir);

    expect(result.detectedPatterns).toContain('docker');
  });

  it('detects test-suite pattern', async () => {
    mkdirSync(join(tempDir, 'tests'));
    writeFileSync(join(tempDir, 'tests', 'app.test.ts'), 'test()');

    const result = await scanCodebase(tempDir);

    expect(result.detectedPatterns).toContain('test-suite');
  });

  it('initializes capabilities as empty array', async () => {
    writeFileSync(join(tempDir, 'index.ts'), 'x');

    const result = await scanCodebase(tempDir);

    expect(result.capabilities).toEqual([]);
  });

  it('counts directories correctly', async () => {
    mkdirSync(join(tempDir, 'src'));
    mkdirSync(join(tempDir, 'src', 'utils'));
    writeFileSync(join(tempDir, 'src', 'index.ts'), 'x');
    writeFileSync(join(tempDir, 'src', 'utils', 'helper.ts'), 'x');

    const result = await scanCodebase(tempDir);

    expect(result.totalDirectories).toBe(2);
    expect(result.totalFiles).toBe(2);
  });
});

describe('formatScanForPrompt', () => {
  it('formats scan result as a string', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'format-test-'));
    writeFileSync(join(tempDir, 'app.ts'), 'export default "app";');
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'test' }));

    try {
      const scan = await scanCodebase(tempDir);
      const formatted = formatScanForPrompt(scan);

      expect(formatted).toContain('Directory structure:');
      expect(formatted).toContain('.ts:');
      expect(formatted).toContain('--- package.json ---');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
