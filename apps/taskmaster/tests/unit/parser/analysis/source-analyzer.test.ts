import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  analyzeSource,
  analyzeSourceEnhanced,
} from '../../../../src/parser/analysis/source-analyzer.js';
import type { BuildComponent } from '../../../../src/parser/analysis/types.js';

describe('analyzeSource', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'source-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('extracts exported functions from TypeScript files', async () => {
    mkdirSync(join(tempDir, 'src'));
    writeFileSync(
      join(tempDir, 'src', 'utils.ts'),
      `export function greet(name: string): string {
  return \`Hello, \${name}\`;
}

function privateHelper() {
  return 42;
}

export const VERSION = '1.0';
`,
    );

    const result = await analyzeSource(tempDir);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].language).toBe('typescript');

    const exported = result.publicApi;
    expect(exported.some((s) => s.name === 'greet' && s.kind === 'function')).toBe(true);
    expect(exported.some((s) => s.name === 'VERSION' && s.kind === 'const')).toBe(true);
    // privateHelper should not be in publicApi since it's not exported
    expect(exported.some((s) => s.name === 'privateHelper')).toBe(false);
  });

  it('extracts exported interfaces and types from TypeScript', async () => {
    writeFileSync(
      join(tempDir, 'types.ts'),
      `export interface User {
  id: string;
  name: string;
}

export type Status = 'active' | 'inactive';

interface InternalState {
  count: number;
}
`,
    );

    const result = await analyzeSource(tempDir);

    const exported = result.publicApi;
    expect(exported.some((s) => s.name === 'User' && s.kind === 'interface')).toBe(true);
    expect(exported.some((s) => s.name === 'Status' && s.kind === 'type')).toBe(true);
    expect(exported.some((s) => s.name === 'InternalState')).toBe(false);
  });

  it('extracts exported classes from TypeScript', async () => {
    writeFileSync(
      join(tempDir, 'service.ts'),
      `export class AuthService {
  login() {}
  logout() {}
}
`,
    );

    const result = await analyzeSource(tempDir);

    const exported = result.publicApi;
    expect(exported.some((s) => s.name === 'AuthService' && s.kind === 'class')).toBe(true);
  });

  it('skips node_modules and other ignored directories', async () => {
    mkdirSync(join(tempDir, 'node_modules'));
    writeFileSync(join(tempDir, 'node_modules', 'lib.ts'), 'export const x = 1;');
    writeFileSync(join(tempDir, 'app.ts'), 'export const y = 2;');

    const result = await analyzeSource(tempDir);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toContain('app.ts');
  });

  it('returns empty result for empty directory', async () => {
    const result = await analyzeSource(tempDir);

    expect(result.files).toHaveLength(0);
    expect(result.publicApi).toHaveLength(0);
    expect(result.summary).toBe('');
  });

  it('generates a formatted summary', async () => {
    writeFileSync(join(tempDir, 'index.ts'), 'export function main() {}\nexport class App {}');

    const result = await analyzeSource(tempDir);

    expect(result.summary).toContain('Source analysis:');
    expect(result.summary).toContain('function main');
    expect(result.summary).toContain('class App');
  });

  it('handles JavaScript files', async () => {
    writeFileSync(join(tempDir, 'helper.js'), `export function add(a, b) { return a + b; }`);

    const result = await analyzeSource(tempDir);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].language).toBe('javascript');
    expect(result.publicApi.some((s) => s.name === 'add')).toBe(true);
  });

  it('skips files larger than 100KB', async () => {
    // Create a file larger than 100KB
    const largeContent = 'x'.repeat(101 * 1024);
    writeFileSync(join(tempDir, 'large.ts'), largeContent);
    writeFileSync(join(tempDir, 'small.ts'), 'export const x = 1;');

    const result = await analyzeSource(tempDir);

    // Only the small file should be analyzed
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toContain('small.ts');
  });
});

// =========================================================================
// Enhanced Source Analysis Tests
// =========================================================================

describe('analyzeSourceEnhanced', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'enhanced-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns both legacy and enhanced results', async () => {
    mkdirSync(join(tempDir, 'src'));
    writeFileSync(
      join(tempDir, 'src', 'utils.ts'),
      'export function greet(name: string): string { return name; }\n',
    );

    const { legacy, enhanced } = await analyzeSourceEnhanced(tempDir);

    // Legacy results still work
    expect(legacy.files).toHaveLength(1);
    expect(legacy.publicApi.some((s) => s.name === 'greet')).toBe(true);

    // Enhanced results present
    expect(enhanced).toHaveLength(1);
    expect(enhanced[0].symbols).toHaveLength(1);
    expect(enhanced[0].symbols[0].name).toBe('greet');
  });

  it('returns empty results for empty directory', async () => {
    const { legacy, enhanced } = await analyzeSourceEnhanced(tempDir);

    expect(legacy.files).toHaveLength(0);
    expect(legacy.summary).toBe('');
    expect(enhanced).toHaveLength(0);
  });

  it('infers layer from file path', async () => {
    // File in routes/ → api layer
    mkdirSync(join(tempDir, 'src', 'routes'), { recursive: true });
    writeFileSync(
      join(tempDir, 'src', 'routes', 'users.ts'),
      'export function getUsers() { return []; }\n',
    );

    // File in config/ → infra layer
    mkdirSync(join(tempDir, 'src', 'config'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'config', 'db.ts'), 'export const DB_URL = "localhost";\n');

    const { enhanced } = await analyzeSourceEnhanced(tempDir);

    const routeFile = enhanced.find((f) => f.path.includes('routes/users'));
    expect(routeFile?.layer).toBe('api');

    const configFile = enhanced.find((f) => f.path.includes('config/db'));
    expect(configFile?.layer).toBe('infra');
  });

  it('enriches kind to route for api layer functions', async () => {
    mkdirSync(join(tempDir, 'src', 'routes'), { recursive: true });
    writeFileSync(
      join(tempDir, 'src', 'routes', 'handler.ts'),
      'export function handleRequest() {}\n',
    );

    const { enhanced } = await analyzeSourceEnhanced(tempDir);

    const sym = enhanced[0].symbols[0];
    expect(sym.kind).toBe('route');
    expect(sym.tags).toContain('layer:api');
    expect(sym.tags).toContain('kind:route');
    expect(sym.tags).toContain('cap:http');
  });

  it('enriches kind to command for cli layer functions', async () => {
    mkdirSync(join(tempDir, 'src', 'cli'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'cli', 'run.ts'), 'export function runCommand() {}\n');

    const { enhanced } = await analyzeSourceEnhanced(tempDir);

    const sym = enhanced[0].symbols[0];
    expect(sym.kind).toBe('command');
    expect(sym.tags).toContain('layer:cli');
    expect(sym.tags).toContain('kind:command');
  });

  it('sets correct visibility for exported vs non-exported symbols', async () => {
    writeFileSync(
      join(tempDir, 'module.ts'),
      `export function publicFn() {}
function privateFn() {}
export const EXPORTED_CONST = 1;
`,
    );

    const { enhanced } = await analyzeSourceEnhanced(tempDir);

    const symbols = enhanced[0].symbols;
    const publicSym = symbols.find((s) => s.name === 'publicFn');
    const privateSym = symbols.find((s) => s.name === 'privateFn');
    const constSym = symbols.find((s) => s.name === 'EXPORTED_CONST');

    expect(publicSym?.visibility).toBe('exported');
    expect(privateSym?.visibility).toBe('file');
    expect(constSym?.visibility).toBe('exported');
  });

  it('includes source range with 1-indexed line numbers', async () => {
    writeFileSync(
      join(tempDir, 'lines.ts'),
      `// line 1
// line 2
export function foo() {
  return 1;
}
`,
    );

    const { enhanced } = await analyzeSourceEnhanced(tempDir);

    const sym = enhanced[0].symbols.find((s) => s.name === 'foo');
    expect(sym).toBeDefined();
    // The export statement starts on line 3
    expect(sym!.source.range.startLine).toBeGreaterThanOrEqual(3);
    expect(sym!.source.range.endLine).toBeGreaterThanOrEqual(3);
    expect(sym!.source.file).toContain('lines.ts');
  });

  it('extracts signature display from function declarations', async () => {
    writeFileSync(
      join(tempDir, 'sigs.ts'),
      `export function greet(name: string): string {
  return name;
}
`,
    );

    const { enhanced } = await analyzeSourceEnhanced(tempDir);

    const sym = enhanced[0].symbols.find((s) => s.name === 'greet');
    expect(sym?.signature?.display).toBeDefined();
    expect(sym!.signature!.display).toContain('greet');
    // Should not include the function body
    expect(sym!.signature!.display).not.toContain('return');
  });

  it('assigns files to components based on path matching', async () => {
    mkdirSync(join(tempDir, 'src'));
    writeFileSync(join(tempDir, 'src', 'app.ts'), 'export function start() {}\n');

    const component: BuildComponent = {
      id: 'my-app',
      name: 'my-app',
      rootPath: tempDir,
      languageSet: ['typescript'],
      entrypoints: ['src/app.ts'],
      publicSurface: [],
      tags: ['component:my-app', 'framework:express'],
    };

    const { enhanced } = await analyzeSourceEnhanced(tempDir, [component]);

    expect(enhanced[0].componentId).toBe('my-app');
    // Entrypoint tag should be present
    const sym = enhanced[0].symbols.find((s) => s.name === 'start');
    expect(sym?.tags).toContain('entrypoint:true');
    // Framework tag from component should be inherited
    expect(sym?.tags).toContain('framework:express');
  });

  it('works without components (no component assignment)', async () => {
    writeFileSync(join(tempDir, 'standalone.ts'), 'export const X = 1;\n');

    const { enhanced } = await analyzeSourceEnhanced(tempDir);

    expect(enhanced[0].componentId).toBeUndefined();
    const sym = enhanced[0].symbols[0];
    expect(sym.tags).not.toContain('entrypoint:true');
  });

  it('uses relative paths in enhanced file analysis', async () => {
    mkdirSync(join(tempDir, 'src', 'lib'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'lib', 'helper.ts'), 'export function help() {}\n');

    const { enhanced } = await analyzeSourceEnhanced(tempDir);

    // Path should be relative to rootPath
    expect(enhanced[0].path).toBe(join('src', 'lib', 'helper.ts'));
    // Symbol filePath should also be relative
    expect(enhanced[0].symbols[0].filePath).toBe(join('src', 'lib', 'helper.ts'));
  });

  it('tags test files with test:true', async () => {
    mkdirSync(join(tempDir, 'tests'), { recursive: true });
    writeFileSync(join(tempDir, 'tests', 'app.test.ts'), 'export function testHelper() {}\n');

    const { enhanced } = await analyzeSourceEnhanced(tempDir);

    expect(enhanced[0].layer).toBe('tests');
    expect(enhanced[0].symbols[0].tags).toContain('test:true');
  });

  it('legacy results match original analyzeSource behavior', async () => {
    mkdirSync(join(tempDir, 'src'));
    writeFileSync(
      join(tempDir, 'src', 'index.ts'),
      `export function main() {}
export class App {}
export interface Config {}
`,
    );

    const original = await analyzeSource(tempDir);
    const { legacy } = await analyzeSourceEnhanced(tempDir);

    // Same number of files and symbols
    expect(legacy.files).toHaveLength(original.files.length);
    expect(legacy.publicApi).toHaveLength(original.publicApi.length);

    // Same symbol names
    const origNames = original.publicApi.map((s) => s.name).sort();
    const legacyNames = legacy.publicApi.map((s) => s.name).sort();
    expect(legacyNames).toEqual(origNames);
  });
});
