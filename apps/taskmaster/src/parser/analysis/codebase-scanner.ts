import { readdir, stat, readFile } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import type { CodebaseScanResult } from './types.js';

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'target', 'vendor',
  '__pycache__', '.next', '.nuxt', '.output', 'coverage',
  '.turbo', '.vercel', '.cache', 'tmp', '.tmp',
]);

const MAX_DEPTH = 4;

const MANIFEST_FILES = new Set([
  'package.json', 'tsconfig.json', 'Cargo.toml', 'go.mod', 'go.sum',
  'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
  '.github/workflows', 'Makefile', 'pyproject.toml', 'requirements.txt',
  'pom.xml', 'build.gradle', 'build.gradle.kts',
]);

/**
 * Walk a directory tree up to MAX_DEPTH, collecting file paths
 * and building a tree string for AI context.
 */
async function walkDirectory(
  rootPath: string,
  currentPath: string,
  depth: number,
  treeLines: string[],
  extensions: Record<string, number>,
  stats: { files: number; dirs: number },
): Promise<void> {
  if (depth > MAX_DEPTH) return;

  let entries;
  try {
    entries = await readdir(currentPath, { withFileTypes: true });
  } catch {
    return;
  }

  // Sort: directories first, then files
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  const indent = '  '.repeat(depth);

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      stats.dirs++;
      treeLines.push(`${indent}${entry.name}/`);
      await walkDirectory(
        rootPath,
        join(currentPath, entry.name),
        depth + 1,
        treeLines,
        extensions,
        stats,
      );
    } else {
      stats.files++;
      const ext = extname(entry.name).toLowerCase() || '(no ext)';
      extensions[ext] = (extensions[ext] ?? 0) + 1;
      // Only show files at depths 0-2 to keep the tree readable
      if (depth <= 2) {
        treeLines.push(`${indent}${entry.name}`);
      }
    }
  }
}

/**
 * Read a manifest file's content, extracting only the relevant parts.
 * For package.json: name, dependencies, devDependencies, scripts.
 * For others: full content (truncated to 2000 chars).
 */
async function readManifest(filePath: string, name: string): Promise<string> {
  try {
    const content = await readFile(filePath, 'utf-8');

    if (name === 'package.json') {
      const pkg = JSON.parse(content);
      const relevant = {
        name: pkg.name,
        dependencies: pkg.dependencies,
        devDependencies: pkg.devDependencies,
        scripts: pkg.scripts ? Object.keys(pkg.scripts) : undefined,
      };
      return JSON.stringify(relevant, null, 2);
    }

    // Truncate large files
    return content.length > 2000 ? content.substring(0, 2000) + '\n...(truncated)' : content;
  } catch {
    return '(could not read)';
  }
}

/**
 * Detect structural patterns from directory tree and file presence.
 */
function detectPatterns(
  treeLines: string[],
  manifests: string[],
  extensions: Record<string, number>,
): string[] {
  const patterns: string[] = [];
  const tree = treeLines.join('\n');

  // Monorepo detection
  if (tree.includes('packages/') || tree.includes('apps/') || tree.includes('workspaces/')) {
    patterns.push('monorepo');
  }

  // Docker
  if (manifests.some(m => m.startsWith('Dockerfile') || m.startsWith('docker-compose'))) {
    patterns.push('docker');
  }

  // CI/CD
  if (tree.includes('.github/') || tree.includes('.gitlab-ci') || tree.includes('Jenkinsfile')) {
    patterns.push('ci-cd');
  }

  // Protocol Buffers
  if (extensions['.proto']) {
    patterns.push('protocol-buffers');
  }

  // Database migrations
  if (tree.includes('migrations/') || tree.includes('migrate/')) {
    patterns.push('database-migrations');
  }

  // Testing frameworks
  if (tree.includes('__tests__/') || tree.includes('tests/') || tree.includes('test/')) {
    patterns.push('test-suite');
  }

  // TypeScript
  if (extensions['.ts'] || extensions['.tsx']) {
    patterns.push('typescript');
  }

  // Frontend frameworks
  if (extensions['.jsx'] || extensions['.tsx'] || extensions['.vue'] || extensions['.svelte']) {
    patterns.push('frontend-framework');
  }

  return patterns;
}

/**
 * Scan a codebase directory to produce a structural summary.
 * No AI calls — pure filesystem inspection.
 */
export async function scanCodebase(rootPath: string): Promise<CodebaseScanResult> {
  const treeLines: string[] = [];
  const extensions: Record<string, number> = {};
  const stats = { files: 0, dirs: 0 };

  await walkDirectory(rootPath, rootPath, 0, treeLines, extensions, stats);

  // Find and read manifest files
  const manifestContents: Record<string, string> = {};
  const detectedManifests: string[] = [];

  for (const manifestName of MANIFEST_FILES) {
    const manifestPath = join(rootPath, manifestName);
    try {
      const s = await stat(manifestPath);
      if (s.isFile()) {
        detectedManifests.push(manifestName);
        manifestContents[manifestName] = await readManifest(manifestPath, manifestName);
      }
    } catch {
      // File doesn't exist — skip
    }
  }

  const detectedPatterns = detectPatterns(treeLines, detectedManifests, extensions);

  return {
    rootPath,
    directoryTree: treeLines.join('\n'),
    fileExtensions: extensions,
    manifestContents,
    detectedPatterns,
    capabilities: [],
    totalFiles: stats.files,
    totalDirectories: stats.dirs,
  };
}

/**
 * Format a CodebaseScanResult into a string suitable for AI prompt inclusion.
 */
export function formatScanForPrompt(scan: CodebaseScanResult): string {
  const sections: string[] = [];

  sections.push('Directory structure:');
  sections.push(scan.directoryTree);
  sections.push('');

  // File extension summary
  const sortedExts = Object.entries(scan.fileExtensions)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  sections.push('File types:');
  for (const [ext, count] of sortedExts) {
    sections.push(`  ${ext}: ${count} file(s)`);
  }
  sections.push('');

  sections.push(`Total: ${scan.totalFiles} files, ${scan.totalDirectories} directories`);
  sections.push('');

  if (scan.detectedPatterns.length > 0) {
    sections.push(`Detected patterns: ${scan.detectedPatterns.join(', ')}`);
    sections.push('');
  }

  // Manifest contents
  for (const [name, content] of Object.entries(scan.manifestContents)) {
    sections.push(`--- ${name} ---`);
    sections.push(content);
    sections.push('');
  }

  return sections.join('\n');
}
