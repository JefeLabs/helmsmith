import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  discoverComponents,
  resolveWorkspaces,
  extractNpmCommands,
  detectFrameworks,
} from '../../../../src/parser/analysis/component-discovery.js';

describe('discoverComponents', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('discovers a single package.json project', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'comp-disc-'));
    mkdirSync(join(tmpDir, 'src'));
    writeFileSync(join(tmpDir, 'src', 'index.ts'), 'export const x = 1;');
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'my-api-server',
        scripts: {
          build: 'tsc',
          test: 'vitest run',
          start: 'node dist/index.js',
        },
        dependencies: {
          express: '^4.18.0',
        },
        devDependencies: {
          typescript: '^5.0.0',
        },
      }),
    );

    const components = await discoverComponents(tmpDir);

    expect(components).toHaveLength(1);
    const comp = components[0];
    expect(comp.id).toBe('my-api-server');
    expect(comp.name).toBe('my-api-server');
    expect(comp.rootPath).toBe(tmpDir);
    expect(comp.howToBuild).toBe('npm run build');
    expect(comp.howToTest).toBe('npm test');
    expect(comp.howToRun).toBe('npm start');
    expect(comp.entrypoints).toContain('src/index.ts');
    expect(comp.publicSurface).toEqual([]);
    expect(comp.languageSet).toContain('typescript');
    expect(comp.tags).toContain('component:my-api-server');
    expect(comp.tags).toContain('build:npm');
    expect(comp.tags).toContain('runtime:node');
    expect(comp.tags).toContain('framework:express');
    expect(comp.tags).toContain('lang:typescript');
  });

  it('discovers monorepo with workspaces', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'comp-disc-mono-'));

    // Root package.json with workspaces
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'my-monorepo',
        private: true,
        workspaces: ['packages/*'],
      }),
    );

    // packages/api
    mkdirSync(join(tmpDir, 'packages'), { recursive: true });
    mkdirSync(join(tmpDir, 'packages', 'api'));
    mkdirSync(join(tmpDir, 'packages', 'api', 'src'));
    writeFileSync(join(tmpDir, 'packages', 'api', 'src', 'index.ts'), 'export {}');
    writeFileSync(
      join(tmpDir, 'packages', 'api', 'package.json'),
      JSON.stringify({
        name: '@myorg/api',
        scripts: { build: 'tsc', test: 'vitest' },
      }),
    );

    // packages/web
    mkdirSync(join(tmpDir, 'packages', 'web'));
    mkdirSync(join(tmpDir, 'packages', 'web', 'src'));
    writeFileSync(join(tmpDir, 'packages', 'web', 'src', 'app.tsx'), 'export {}');
    writeFileSync(
      join(tmpDir, 'packages', 'web', 'package.json'),
      JSON.stringify({
        name: '@myorg/web',
        scripts: { build: 'vite build', dev: 'vite dev' },
        dependencies: { react: '^18.0.0' },
      }),
    );

    const components = await discoverComponents(tmpDir);

    // Root has no src/, so only workspace components are discovered
    expect(components).toHaveLength(2);

    const apiComp = components.find(c => c.id === 'api');
    expect(apiComp).toBeDefined();
    expect(apiComp!.name).toBe('@myorg/api');
    expect(apiComp!.howToBuild).toBe('npm run build');
    expect(apiComp!.howToTest).toBe('npm test');

    const webComp = components.find(c => c.id === 'web');
    expect(webComp).toBeDefined();
    expect(webComp!.name).toBe('@myorg/web');
    expect(webComp!.howToBuild).toBe('npm run build');
    expect(webComp!.howToRun).toBe('npm run dev');
    expect(webComp!.tags).toContain('framework:react');
  });

  it('includes root component in monorepo if root has src/', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'comp-disc-mono-root-'));

    mkdirSync(join(tmpDir, 'src'));
    writeFileSync(join(tmpDir, 'src', 'cli.ts'), 'console.log("cli")');
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'tooling-mono',
        workspaces: ['packages/*'],
        scripts: { build: 'tsup' },
      }),
    );

    mkdirSync(join(tmpDir, 'packages'), { recursive: true });
    mkdirSync(join(tmpDir, 'packages', 'core'));
    writeFileSync(
      join(tmpDir, 'packages', 'core', 'package.json'),
      JSON.stringify({ name: '@tooling/core' }),
    );

    const components = await discoverComponents(tmpDir);

    // Should include root + workspace package
    expect(components).toHaveLength(2);
    const rootComp = components.find(c => c.rootPath === tmpDir);
    expect(rootComp).toBeDefined();
    expect(rootComp!.name).toBe('tooling-mono');
  });

  it('returns empty array for directory with no manifests', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'comp-disc-empty-'));
    writeFileSync(join(tmpDir, 'README.md'), '# Hello');

    const components = await discoverComponents(tmpDir);

    expect(components).toEqual([]);
  });

  it('discovers Go project from go.mod', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'comp-disc-go-'));
    writeFileSync(join(tmpDir, 'go.mod'), 'module github.com/user/myservice\n\ngo 1.21\n');
    writeFileSync(join(tmpDir, 'main.go'), 'package main\nfunc main() {}');

    const components = await discoverComponents(tmpDir);

    expect(components).toHaveLength(1);
    const comp = components[0];
    expect(comp.name).toBe('github.com/user/myservice');
    expect(comp.languageSet).toContain('go');
    expect(comp.howToBuild).toBe('go build ./...');
    expect(comp.howToTest).toBe('go test ./...');
    expect(comp.tags).toContain('build:go');
    expect(comp.tags).toContain('runtime:go');
    expect(comp.tags).toContain('lang:go');
    expect(comp.entrypoints).toContain('main.go');
    expect(comp.publicSurface).toEqual([]);
  });

  it('discovers Rust project from Cargo.toml', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'comp-disc-rust-'));
    writeFileSync(
      join(tmpDir, 'Cargo.toml'),
      '[package]\nname = "my-rust-cli"\nversion = "0.1.0"\nedition = "2021"\n',
    );
    mkdirSync(join(tmpDir, 'src'));
    writeFileSync(join(tmpDir, 'src', 'main.rs'), 'fn main() {}');

    const components = await discoverComponents(tmpDir);

    expect(components).toHaveLength(1);
    const comp = components[0];
    expect(comp.id).toBe('my-rust-cli');
    expect(comp.name).toBe('my-rust-cli');
    expect(comp.languageSet).toContain('rust');
    expect(comp.howToBuild).toBe('cargo build');
    expect(comp.howToTest).toBe('cargo test');
    expect(comp.tags).toContain('build:cargo');
    expect(comp.tags).toContain('runtime:rust');
    expect(comp.tags).toContain('lang:rust');
    expect(comp.entrypoints).toContain('src/main.rs');
    expect(comp.publicSurface).toEqual([]);
  });

  it('discovers Rust workspace with members', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'comp-disc-rust-ws-'));

    writeFileSync(
      join(tmpDir, 'Cargo.toml'),
      '[workspace]\nmembers = [\n  "crates/*"\n]\n',
    );

    mkdirSync(join(tmpDir, 'crates'), { recursive: true });
    mkdirSync(join(tmpDir, 'crates', 'core'));
    writeFileSync(
      join(tmpDir, 'crates', 'core', 'Cargo.toml'),
      '[package]\nname = "mylib-core"\nversion = "0.1.0"\n',
    );
    mkdirSync(join(tmpDir, 'crates', 'core', 'src'));
    writeFileSync(join(tmpDir, 'crates', 'core', 'src', 'lib.rs'), 'pub fn hello() {}');

    mkdirSync(join(tmpDir, 'crates', 'cli'));
    writeFileSync(
      join(tmpDir, 'crates', 'cli', 'Cargo.toml'),
      '[package]\nname = "mylib-cli"\nversion = "0.1.0"\n',
    );
    mkdirSync(join(tmpDir, 'crates', 'cli', 'src'));
    writeFileSync(join(tmpDir, 'crates', 'cli', 'src', 'main.rs'), 'fn main() {}');

    const components = await discoverComponents(tmpDir);

    expect(components).toHaveLength(2);
    const names = components.map(c => c.name).sort();
    expect(names).toEqual(['mylib-cli', 'mylib-core']);
  });

  it('discovers JVM project from pom.xml', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'comp-disc-jvm-'));
    writeFileSync(join(tmpDir, 'pom.xml'), '<project></project>');
    mkdirSync(join(tmpDir, 'src', 'main', 'java'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'src', 'main', 'java', 'App.java'),
      'public class App {}',
    );

    const components = await discoverComponents(tmpDir);

    expect(components).toHaveLength(1);
    const comp = components[0];
    expect(comp.tags).toContain('build:maven');
    expect(comp.tags).toContain('runtime:jvm');
    expect(comp.howToBuild).toBe('mvn package');
    expect(comp.howToTest).toBe('mvn test');
    expect(comp.languageSet).toContain('java');
  });

  it('discovers JVM project from build.gradle', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'comp-disc-gradle-'));
    writeFileSync(join(tmpDir, 'build.gradle'), 'apply plugin: "java"');
    mkdirSync(join(tmpDir, 'src', 'main', 'java'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'src', 'main', 'java', 'App.java'),
      'public class App {}',
    );

    const components = await discoverComponents(tmpDir);

    expect(components).toHaveLength(1);
    const comp = components[0];
    expect(comp.tags).toContain('build:gradle');
    expect(comp.howToBuild).toBe('./gradlew build');
    expect(comp.howToTest).toBe('./gradlew test');
  });

  it('discovers .NET project from .csproj', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'comp-disc-dotnet-'));
    writeFileSync(join(tmpDir, 'MyApp.csproj'), '<Project></Project>');
    writeFileSync(join(tmpDir, 'Program.cs'), 'class Program {}');

    const components = await discoverComponents(tmpDir);

    expect(components).toHaveLength(1);
    const comp = components[0];
    expect(comp.id).toBe('my-app');
    expect(comp.name).toBe('MyApp');
    expect(comp.tags).toContain('build:dotnet');
    expect(comp.tags).toContain('runtime:dotnet');
    expect(comp.howToBuild).toBe('dotnet build');
    expect(comp.howToTest).toBe('dotnet test');
    expect(comp.languageSet).toContain('csharp');
  });

  it('discovers script component from Makefile when no other manifest', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'comp-disc-make-'));
    writeFileSync(join(tmpDir, 'Makefile'), 'all:\n\techo "build"');
    writeFileSync(join(tmpDir, 'main.c'), 'int main() {}');

    const components = await discoverComponents(tmpDir);

    expect(components).toHaveLength(1);
    const comp = components[0];
    expect(comp.tags).toContain('build:make');
    expect(comp.howToBuild).toBe('make');
    expect(comp.languageSet).toContain('c');
  });

  it('does not create script component if another manifest exists at root', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'comp-disc-make-skip-'));
    writeFileSync(join(tmpDir, 'Makefile'), 'all:\n\techo "build"');
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'has-pkg', scripts: { build: 'tsc' } }),
    );
    mkdirSync(join(tmpDir, 'src'));
    writeFileSync(join(tmpDir, 'src', 'index.ts'), 'export {}');

    const components = await discoverComponents(tmpDir);

    // Should only have the Node component, not the Makefile one
    const makeComp = components.find(c => c.tags.includes('build:make'));
    expect(makeComp).toBeUndefined();
    const nodeComp = components.find(c => c.tags.includes('build:npm'));
    expect(nodeComp).toBeDefined();
  });

  it('handles scoped package names correctly', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'comp-disc-scoped-'));
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: '@my-org/cool-package' }),
    );

    const components = await discoverComponents(tmpDir);

    expect(components).toHaveLength(1);
    expect(components[0].id).toBe('cool-package');
    expect(components[0].name).toBe('@my-org/cool-package');
  });

  it('detects bin entrypoints from package.json', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'comp-disc-bin-'));
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'my-cli',
        bin: { 'my-cli': './bin/cli.js' },
        main: './dist/index.js',
      }),
    );

    const components = await discoverComponents(tmpDir);

    expect(components).toHaveLength(1);
    expect(components[0].entrypoints).toContain('./bin/cli.js');
    expect(components[0].entrypoints).toContain('./dist/index.js');
  });
});

describe('extractNpmCommands', () => {
  it('extracts build, test, and start scripts', () => {
    const result = extractNpmCommands({
      scripts: {
        build: 'tsc',
        test: 'vitest run',
        start: 'node dist/index.js',
      },
    });

    expect(result.howToBuild).toBe('npm run build');
    expect(result.howToTest).toBe('npm test');
    expect(result.howToRun).toBe('npm start');
  });

  it('uses dev script for howToRun when start is absent', () => {
    const result = extractNpmCommands({
      scripts: {
        dev: 'vite dev',
      },
    });

    expect(result.howToRun).toBe('npm run dev');
    expect(result.howToBuild).toBeUndefined();
    expect(result.howToTest).toBeUndefined();
  });

  it('skips default npm test error script', () => {
    const result = extractNpmCommands({
      scripts: {
        test: 'echo "Error: no test specified" && exit 1',
      },
    });

    expect(result.howToTest).toBeUndefined();
  });

  it('returns empty object when no scripts', () => {
    expect(extractNpmCommands({})).toEqual({});
    expect(extractNpmCommands({ scripts: undefined })).toEqual({});
  });
});

describe('detectFrameworks', () => {
  it('detects express framework', () => {
    const tags = detectFrameworks({ express: '^4.18.0' });
    expect(tags).toContain('framework:express');
  });

  it('detects react and next together', () => {
    const tags = detectFrameworks({
      react: '^18.0.0',
      next: '^14.0.0',
      'react-dom': '^18.0.0',
    });
    expect(tags).toContain('framework:react');
    expect(tags).toContain('framework:next');
  });

  it('detects angular framework', () => {
    const tags = detectFrameworks({ '@angular/core': '^17.0.0' });
    expect(tags).toContain('framework:angular');
  });

  it('detects nestjs framework', () => {
    const tags = detectFrameworks({ '@nestjs/core': '^10.0.0' });
    expect(tags).toContain('framework:nestjs');
  });

  it('detects vue framework', () => {
    const tags = detectFrameworks({ vue: '^3.0.0' });
    expect(tags).toContain('framework:vue');
  });

  it('detects nuxt framework', () => {
    const tags = detectFrameworks({ nuxt: '^3.0.0' });
    expect(tags).toContain('framework:nuxt');
  });

  it('detects fastify framework', () => {
    const tags = detectFrameworks({ fastify: '^4.0.0' });
    expect(tags).toContain('framework:fastify');
  });

  it('detects hono framework', () => {
    const tags = detectFrameworks({ hono: '^3.0.0' });
    expect(tags).toContain('framework:hono');
  });

  it('returns empty array when no frameworks found', () => {
    const tags = detectFrameworks({ lodash: '^4.0.0', zod: '^3.0.0' });
    expect(tags).toEqual([]);
  });
});

describe('resolveWorkspaces', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('resolves simple glob pattern packages/*', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ws-resolve-'));
    mkdirSync(join(tmpDir, 'packages', 'alpha'), { recursive: true });
    mkdirSync(join(tmpDir, 'packages', 'beta'), { recursive: true });

    const dirs = await resolveWorkspaces(
      { workspaces: ['packages/*'] },
      tmpDir,
    );

    expect(dirs).toHaveLength(2);
    expect(dirs.sort()).toEqual([
      join(tmpDir, 'packages', 'alpha'),
      join(tmpDir, 'packages', 'beta'),
    ]);
  });

  it('handles object format { packages: [...] }', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ws-resolve-obj-'));
    mkdirSync(join(tmpDir, 'libs', 'shared'), { recursive: true });

    const dirs = await resolveWorkspaces(
      { workspaces: { packages: ['libs/*'] } },
      tmpDir,
    );

    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toBe(join(tmpDir, 'libs', 'shared'));
  });

  it('returns empty array when workspaces field is absent', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ws-resolve-none-'));

    const dirs = await resolveWorkspaces({}, tmpDir);

    expect(dirs).toEqual([]);
  });

  it('returns empty array for empty workspaces array', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ws-resolve-empty-'));

    const dirs = await resolveWorkspaces({ workspaces: [] }, tmpDir);

    expect(dirs).toEqual([]);
  });

  it('handles literal directory paths (not globs)', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ws-resolve-literal-'));
    mkdirSync(join(tmpDir, 'tools', 'linter'), { recursive: true });

    const dirs = await resolveWorkspaces(
      { workspaces: ['tools/linter'] },
      tmpDir,
    );

    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toBe(join(tmpDir, 'tools', 'linter'));
  });

  it('skips nonexistent workspace directories', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ws-resolve-miss-'));

    const dirs = await resolveWorkspaces(
      { workspaces: ['does-not-exist/*'] },
      tmpDir,
    );

    expect(dirs).toEqual([]);
  });
});
