import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { BuildComponent, EnhancedSourceSymbol } from './types.js';

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', 'vendor']);

// --- Language detection by file extension ---

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.cs': 'csharp',
  '.fs': 'fsharp',
  '.py': 'python',
  '.rb': 'ruby',
  '.swift': 'swift',
  '.c': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
};

// --- Framework detection map ---

const FRAMEWORK_MAP: Record<string, string> = {
  express: 'framework:express',
  fastify: 'framework:fastify',
  '@nestjs/core': 'framework:nestjs',
  react: 'framework:react',
  vue: 'framework:vue',
  next: 'framework:next',
  nuxt: 'framework:nuxt',
  '@angular/core': 'framework:angular',
  hono: 'framework:hono',
};

// --- Helper: convert name to kebab-case ---

function toKebabCase(name: string): string {
  // Handle scoped packages like @scope/package-name -> package-name
  const unscoped = name.startsWith('@') ? name.split('/').pop()! : name;
  return unscoped
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

// --- Helper: detect languages from file extensions in a directory ---

async function detectLanguages(dirPath: string): Promise<string[]> {
  const languages = new Set<string>();

  async function walk(currentPath: string, depth: number): Promise<void> {
    if (depth > 4) return;
    // biome-ignore lint/suspicious/noImplicitAnyLet: assigned in try/catch below
    let entries;
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        await walk(join(currentPath, entry.name), depth + 1);
      } else {
        const dotIdx = entry.name.lastIndexOf('.');
        if (dotIdx !== -1) {
          const ext = entry.name.slice(dotIdx).toLowerCase();
          const lang = EXTENSION_TO_LANGUAGE[ext];
          if (lang) languages.add(lang);
        }
      }
    }
  }

  await walk(dirPath, 0);
  return [...languages].sort();
}

// --- Helper: find common entrypoints ---

async function findEntrypoints(rootPath: string, pkg?: Record<string, unknown>): Promise<string[]> {
  const entrypoints: string[] = [];

  // From package.json main/bin fields
  if (pkg) {
    if (typeof pkg.main === 'string') {
      entrypoints.push(pkg.main);
    }
    if (typeof pkg.bin === 'string') {
      entrypoints.push(pkg.bin);
    } else if (pkg.bin && typeof pkg.bin === 'object') {
      entrypoints.push(...Object.values(pkg.bin as Record<string, string>));
    }
    if (typeof pkg.module === 'string') {
      entrypoints.push(pkg.module);
    }
  }

  // Detect common entrypoint patterns when no manifest entrypoints found
  if (entrypoints.length === 0) {
    const candidates = [
      'src/index.ts',
      'src/index.js',
      'src/main.ts',
      'src/main.js',
      'src/app.ts',
      'src/app.js',
      'index.ts',
      'index.js',
      'lib/index.ts',
      'lib/index.js',
      'main.go',
      'src/main.rs',
      'src/lib.rs',
    ];
    for (const candidate of candidates) {
      if (existsSync(join(rootPath, candidate))) {
        entrypoints.push(candidate);
      }
    }
  }

  return entrypoints;
}

// --- Exported functions ---

/**
 * Extract build/test/run commands from package.json scripts.
 */
export function extractNpmCommands(pkg: Record<string, unknown>): {
  howToBuild?: string;
  howToTest?: string;
  howToRun?: string;
} {
  const scripts = pkg.scripts as Record<string, string> | undefined;
  if (!scripts || typeof scripts !== 'object') {
    return {};
  }

  const result: { howToBuild?: string; howToTest?: string; howToRun?: string } = {};

  if (scripts.build) {
    result.howToBuild = `npm run build`;
  }

  if (scripts.test && !scripts.test.includes('Error: no test specified')) {
    result.howToTest = `npm test`;
  }

  if (scripts.start) {
    result.howToRun = `npm start`;
  } else if (scripts.dev) {
    result.howToRun = `npm run dev`;
  }

  return result;
}

/**
 * Detect frameworks from a dependencies object.
 * Returns tags like `framework:express`, `framework:react`, etc.
 */
export function detectFrameworks(deps: Record<string, string>): string[] {
  const tags: string[] = [];
  for (const [pkgName, tag] of Object.entries(FRAMEWORK_MAP)) {
    if (pkgName in deps) {
      tags.push(tag);
    }
  }
  return tags.sort();
}

/**
 * Resolve workspace patterns from a package.json `workspaces` field.
 * Supports both array format and object format (`{ packages: [...] }`).
 * Expands simple glob patterns like `packages/*` into directory paths.
 */
export async function resolveWorkspaces(
  pkg: Record<string, unknown>,
  rootPath: string,
): Promise<string[]> {
  let patterns: string[] = [];

  if (Array.isArray(pkg.workspaces)) {
    patterns = pkg.workspaces as string[];
  } else if (
    pkg.workspaces &&
    typeof pkg.workspaces === 'object' &&
    !Array.isArray(pkg.workspaces)
  ) {
    const wsObj = pkg.workspaces as Record<string, unknown>;
    if (Array.isArray(wsObj.packages)) {
      patterns = wsObj.packages as string[];
    }
  }

  if (patterns.length === 0) return [];

  const resolved: string[] = [];

  for (const pattern of patterns) {
    if (pattern.endsWith('/*')) {
      // Expand glob: list all directories inside the parent
      const parentDir = pattern.slice(0, -2);
      const parentPath = join(rootPath, parentDir);
      try {
        const entries = await readdir(parentPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name)) {
            resolved.push(join(parentPath, entry.name));
          }
        }
      } catch {
        // Parent directory does not exist - skip
      }
    } else {
      // Treat as a literal directory path
      const dirPath = join(rootPath, pattern);
      try {
        const s = await stat(dirPath);
        if (s.isDirectory()) {
          resolved.push(dirPath);
        }
      } catch {
        // Directory does not exist - skip
      }
    }
  }

  return resolved;
}

/**
 * Build a BuildComponent from a package.json at the given directory.
 */
async function buildNodeComponent(
  dirPath: string,
  pkg: Record<string, unknown>,
): Promise<BuildComponent> {
  const name = typeof pkg.name === 'string' ? pkg.name : basename(dirPath);
  const id = toKebabCase(name);

  const commands = extractNpmCommands(pkg);
  const languageSet = await detectLanguages(dirPath);
  const entrypoints = await findEntrypoints(dirPath, pkg);
  const publicSurface: EnhancedSourceSymbol[] = [];

  // Build tags
  const tags: string[] = [`component:${id}`, 'build:npm', 'runtime:node'];

  // Detect frameworks from dependencies
  const allDeps: Record<string, string> = {
    ...(pkg.dependencies as Record<string, string> | undefined),
    ...(pkg.devDependencies as Record<string, string> | undefined),
  };
  const frameworkTags = detectFrameworks(allDeps);
  tags.push(...frameworkTags);

  // Add language tags
  for (const lang of languageSet) {
    tags.push(`lang:${lang}`);
  }

  return {
    id,
    name,
    rootPath: dirPath,
    languageSet,
    ...commands,
    entrypoints,
    entryPointIds: [],
    publicSurface,
    tags,
  };
}

/**
 * Build a BuildComponent from a go.mod file at the given directory.
 */
async function buildGoComponent(dirPath: string): Promise<BuildComponent> {
  const id = toKebabCase(basename(dirPath));
  const name = basename(dirPath);

  // Try to extract module name from go.mod
  let moduleName = name;
  try {
    const goModContent = await readFile(join(dirPath, 'go.mod'), 'utf-8');
    const moduleMatch = goModContent.match(/^module\s+(.+)$/m);
    if (moduleMatch) {
      moduleName = moduleMatch[1].trim();
    }
  } catch {
    // Use directory name
  }

  const languageSet = await detectLanguages(dirPath);
  if (!languageSet.includes('go')) {
    languageSet.push('go');
    languageSet.sort();
  }
  const entrypoints = await findEntrypoints(dirPath);
  const publicSurface: EnhancedSourceSymbol[] = [];

  const tags: string[] = [
    `component:${id}`,
    'build:go',
    'runtime:go',
    ...languageSet.map((l) => `lang:${l}`),
  ];

  return {
    id,
    name: moduleName,
    rootPath: dirPath,
    languageSet,
    howToBuild: 'go build ./...',
    howToTest: 'go test ./...',
    entrypoints,
    entryPointIds: [],
    publicSurface,
    tags,
  };
}

/**
 * Build a BuildComponent from a Cargo.toml file at the given directory.
 */
async function buildRustComponent(dirPath: string): Promise<BuildComponent> {
  const _id = toKebabCase(basename(dirPath));
  let name = basename(dirPath);

  // Try to extract package name from Cargo.toml
  try {
    const cargoContent = await readFile(join(dirPath, 'Cargo.toml'), 'utf-8');
    const nameMatch = cargoContent.match(/^\s*name\s*=\s*"(.+?)"/m);
    if (nameMatch) {
      name = nameMatch[1];
    }
  } catch {
    // Use directory name
  }

  const languageSet = await detectLanguages(dirPath);
  if (!languageSet.includes('rust')) {
    languageSet.push('rust');
    languageSet.sort();
  }
  const entrypoints = await findEntrypoints(dirPath);
  const publicSurface: EnhancedSourceSymbol[] = [];

  const tags: string[] = [
    `component:${toKebabCase(name)}`,
    'build:cargo',
    'runtime:rust',
    ...languageSet.map((l) => `lang:${l}`),
  ];

  return {
    id: toKebabCase(name),
    name,
    rootPath: dirPath,
    languageSet,
    howToBuild: 'cargo build',
    howToTest: 'cargo test',
    entrypoints,
    entryPointIds: [],
    publicSurface,
    tags,
  };
}

/**
 * Build a BuildComponent from a JVM manifest (pom.xml, build.gradle, etc.).
 */
async function buildJvmComponent(dirPath: string, manifestName: string): Promise<BuildComponent> {
  const id = toKebabCase(basename(dirPath));
  const name = basename(dirPath);
  const languageSet = await detectLanguages(dirPath);
  const entrypoints = await findEntrypoints(dirPath);
  const publicSurface: EnhancedSourceSymbol[] = [];

  const isGradle = manifestName.startsWith('build.gradle');
  const buildTool = isGradle ? 'gradle' : 'maven';
  const runtime = languageSet.includes('kotlin') ? 'jvm' : 'jvm';

  const tags: string[] = [
    `component:${id}`,
    `build:${buildTool}`,
    `runtime:${runtime}`,
    ...languageSet.map((l) => `lang:${l}`),
  ];

  const howToBuild = isGradle ? './gradlew build' : 'mvn package';
  const howToTest = isGradle ? './gradlew test' : 'mvn test';

  return {
    id,
    name,
    rootPath: dirPath,
    languageSet,
    howToBuild,
    howToTest,
    entrypoints,
    entryPointIds: [],
    publicSurface,
    tags,
  };
}

/**
 * Build a BuildComponent from a .NET manifest (*.sln or *.csproj).
 */
async function buildDotnetComponent(
  dirPath: string,
  manifestName: string,
): Promise<BuildComponent> {
  const projectName = manifestName.replace(/\.(sln|csproj)$/, '');
  const id = toKebabCase(projectName || basename(dirPath));
  const name = projectName || basename(dirPath);
  const languageSet = await detectLanguages(dirPath);
  const entrypoints = await findEntrypoints(dirPath);
  const publicSurface: EnhancedSourceSymbol[] = [];

  const tags: string[] = [
    `component:${id}`,
    'build:dotnet',
    'runtime:dotnet',
    ...languageSet.map((l) => `lang:${l}`),
  ];

  return {
    id,
    name,
    rootPath: dirPath,
    languageSet,
    howToBuild: 'dotnet build',
    howToTest: 'dotnet test',
    entrypoints,
    entryPointIds: [],
    publicSurface,
    tags,
  };
}

/**
 * Build a BuildComponent from a script-oriented manifest (Makefile, Taskfile, justfile).
 */
async function buildScriptComponent(
  dirPath: string,
  manifestName: string,
): Promise<BuildComponent> {
  const id = toKebabCase(basename(dirPath));
  const name = basename(dirPath);
  const languageSet = await detectLanguages(dirPath);
  const entrypoints = await findEntrypoints(dirPath);
  const publicSurface: EnhancedSourceSymbol[] = [];

  let buildTool: string;
  let howToBuild: string;
  if (manifestName === 'Makefile') {
    buildTool = 'make';
    howToBuild = 'make';
  } else if (manifestName === 'Taskfile.yml') {
    buildTool = 'task';
    howToBuild = 'task build';
  } else {
    buildTool = 'just';
    howToBuild = 'just build';
  }

  const tags: string[] = [
    `component:${id}`,
    `build:${buildTool}`,
    ...languageSet.map((l) => `lang:${l}`),
  ];

  return {
    id,
    name,
    rootPath: dirPath,
    languageSet,
    howToBuild,
    entrypoints,
    entryPointIds: [],
    publicSurface,
    tags,
  };
}

/**
 * Check whether a directory has its own source code (src/ or lib/ subdirectory).
 */
function hasSourceDir(rootPath: string): boolean {
  return existsSync(join(rootPath, 'src')) || existsSync(join(rootPath, 'lib'));
}

/**
 * Resolve Cargo workspace members from a Cargo.toml `[workspace]` section.
 */
async function resolveCargoWorkspaces(cargoContent: string, rootPath: string): Promise<string[]> {
  // Simple extraction of members from [workspace] section
  const membersMatch = cargoContent.match(/\[workspace\][\s\S]*?members\s*=\s*\[([\s\S]*?)\]/);
  if (!membersMatch) return [];

  const membersStr = membersMatch[1];
  const patterns = [...membersStr.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

  const resolved: string[] = [];
  for (const pattern of patterns) {
    if (pattern.endsWith('/*')) {
      const parentDir = pattern.slice(0, -2);
      const parentPath = join(rootPath, parentDir);
      try {
        const entries = await readdir(parentPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name)) {
            resolved.push(join(parentPath, entry.name));
          }
        }
      } catch {
        // skip
      }
    } else {
      const dirPath = join(rootPath, pattern);
      try {
        const s = await stat(dirPath);
        if (s.isDirectory()) {
          resolved.push(dirPath);
        }
      } catch {
        // skip
      }
    }
  }

  return resolved;
}

/**
 * Resolve Go workspace directories from a go.work file.
 */
async function resolveGoWorkspaces(goWorkContent: string, rootPath: string): Promise<string[]> {
  const resolved: string[] = [];
  const useMatch = goWorkContent.match(/use\s*\(([\s\S]*?)\)/);
  if (useMatch) {
    const lines = useMatch[1].split('\n');
    for (const line of lines) {
      const dir = line.trim();
      if (dir && !dir.startsWith('//')) {
        const dirPath = join(rootPath, dir);
        try {
          const s = await stat(dirPath);
          if (s.isDirectory()) {
            resolved.push(dirPath);
          }
        } catch {
          // skip
        }
      }
    }
  }
  return resolved;
}

/**
 * Main entry point: discover buildable components from manifest files.
 *
 * Walks the rootPath looking for package.json, go.mod, Cargo.toml,
 * pom.xml, build.gradle, *.sln, *.csproj, Makefile, Taskfile.yml, and justfile.
 *
 * Returns an array of BuildComponent descriptors with detected metadata.
 */
export async function discoverComponents(rootPath: string): Promise<BuildComponent[]> {
  const components: BuildComponent[] = [];

  // --- 1. Check for package.json ---
  const pkgJsonPath = join(rootPath, 'package.json');
  if (existsSync(pkgJsonPath)) {
    try {
      const pkgRaw = await readFile(pkgJsonPath, 'utf-8');
      const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;

      // Check for workspaces (monorepo)
      const workspaceDirs = await resolveWorkspaces(pkg, rootPath);
      if (workspaceDirs.length > 0) {
        for (const wsDir of workspaceDirs) {
          const wsPkgPath = join(wsDir, 'package.json');
          if (existsSync(wsPkgPath)) {
            try {
              const wsPkgRaw = await readFile(wsPkgPath, 'utf-8');
              const wsPkg = JSON.parse(wsPkgRaw) as Record<string, unknown>;
              components.push(await buildNodeComponent(wsDir, wsPkg));
            } catch {
              // Skip malformed workspace package.json
            }
          }
        }
        // Also create a component for root if it has its own source
        if (hasSourceDir(rootPath)) {
          components.push(await buildNodeComponent(rootPath, pkg));
        }
      } else {
        // Single package project
        components.push(await buildNodeComponent(rootPath, pkg));
      }
    } catch {
      // Malformed package.json - skip
    }
  }

  // --- 2. Check for go.mod ---
  const goModPath = join(rootPath, 'go.mod');
  if (existsSync(goModPath)) {
    // Check for go.work (Go workspace)
    const goWorkPath = join(rootPath, 'go.work');
    if (existsSync(goWorkPath)) {
      try {
        const goWorkContent = await readFile(goWorkPath, 'utf-8');
        const workspaceDirs = await resolveGoWorkspaces(goWorkContent, rootPath);
        for (const wsDir of workspaceDirs) {
          if (existsSync(join(wsDir, 'go.mod'))) {
            components.push(await buildGoComponent(wsDir));
          }
        }
      } catch {
        // Fall back to single module
        components.push(await buildGoComponent(rootPath));
      }
    } else {
      components.push(await buildGoComponent(rootPath));
    }
  }

  // --- 3. Check for Cargo.toml ---
  const cargoPath = join(rootPath, 'Cargo.toml');
  if (existsSync(cargoPath)) {
    try {
      const cargoContent = await readFile(cargoPath, 'utf-8');
      if (cargoContent.includes('[workspace]')) {
        const workspaceDirs = await resolveCargoWorkspaces(cargoContent, rootPath);
        for (const wsDir of workspaceDirs) {
          if (existsSync(join(wsDir, 'Cargo.toml'))) {
            components.push(await buildRustComponent(wsDir));
          }
        }
      } else {
        components.push(await buildRustComponent(rootPath));
      }
    } catch {
      // Skip malformed Cargo.toml
    }
  }

  // --- 4. Check for JVM manifests ---
  const jvmManifests = ['pom.xml', 'build.gradle', 'build.gradle.kts'];
  for (const manifestName of jvmManifests) {
    const manifestPath = join(rootPath, manifestName);
    if (existsSync(manifestPath)) {
      components.push(await buildJvmComponent(rootPath, manifestName));
      break; // Only pick one JVM manifest
    }
  }

  // --- 5. Check for .NET manifests ---
  try {
    const rootEntries = await readdir(rootPath, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (entry.isFile()) {
        if (entry.name.endsWith('.sln') || entry.name.endsWith('.csproj')) {
          components.push(await buildDotnetComponent(rootPath, entry.name));
          break; // Pick first .NET manifest found
        }
      }
    }
  } catch {
    // Skip if can't read directory
  }

  // --- 6. Check for script-oriented manifests ---
  const scriptManifests = ['Makefile', 'Taskfile.yml', 'justfile'];
  for (const manifestName of scriptManifests) {
    const manifestPath = join(rootPath, manifestName);
    if (existsSync(manifestPath)) {
      // Only create a script component if no other component was found for this root
      const hasComponentAtRoot = components.some((c) => c.rootPath === rootPath);
      if (!hasComponentAtRoot) {
        components.push(await buildScriptComponent(rootPath, manifestName));
        break;
      }
    }
  }

  return components;
}
