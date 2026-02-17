/**
 * Rebrand script — reads branding.yaml and applies find-and-replace across the codebase.
 *
 * Usage: npx tsx scripts/rebrand.ts
 *        npx tsx scripts/rebrand.ts --dry-run
 */

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { globSync } from 'node:fs';

// ── Current brand values (must match src/config/branding.ts) ──
const CURRENT_APP_GROUP_NAME = 'agentx';
const CURRENT_APP_NAME = 'taskmaster';

interface BrandingConfig {
  appGroupName: string;
  appName: string;
  description?: string;
  version?: string;
  repo_url?: string;
  author?: string;
  license?: string;
  keywords?: string[];
  files_to_update?: string[];
  files_to_rename?: Array<{ from: string; to: string }>;
}

interface DerivedBrand {
  appGroupName: string;
  appName: string;
  cliBinName: string;
  configParentDir: string;
  configDirName: string;
  manifestFilename: string;
  configDirDisplay: string;
  envConfigOverride: string;
}

function deriveBrand(group: string, name: string): DerivedBrand {
  return {
    appGroupName: group,
    appName: name,
    cliBinName: `${group}-${name}`,
    configParentDir: `.${group}`,
    configDirName: name,
    manifestFilename: `${name}.yaml`,
    configDirDisplay: `~/.${group}/${name}`,
    envConfigOverride: `${group.toUpperCase()}_HOME`,
  };
}

function resolveBranding(yamlPath: string): BrandingConfig {
  const raw = readFileSync(yamlPath, 'utf-8');
  const parsed = loadYaml(raw) as BrandingConfig;

  if (!parsed.appGroupName || !parsed.appName) {
    throw new Error('branding.yaml must define appGroupName and appName');
  }

  return parsed;
}

/**
 * Build ordered replacement pairs (specific-to-general to avoid partial matches).
 */
function buildReplacements(current: DerivedBrand, next: DerivedBrand): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];

  // 1. Display paths (most specific compound strings first)
  if (current.configDirDisplay !== next.configDirDisplay) {
    pairs.push([current.configDirDisplay, next.configDirDisplay]);
  }

  // 2. CLI bin name (compound: group-name)
  if (current.cliBinName !== next.cliBinName) {
    pairs.push([current.cliBinName, next.cliBinName]);
  }

  // 3. Config parent dir (dotfolder name)
  if (current.configParentDir !== next.configParentDir) {
    pairs.push([current.configParentDir, next.configParentDir]);
  }

  // 4. Manifest filename
  if (current.manifestFilename !== next.manifestFilename) {
    pairs.push([current.manifestFilename, next.manifestFilename]);
  }

  // 5. Env var name
  if (current.envConfigOverride !== next.envConfigOverride) {
    pairs.push([current.envConfigOverride, next.envConfigOverride]);
  }

  // 6. Bare group name (last — most generic)
  if (current.appGroupName !== next.appGroupName) {
    pairs.push([current.appGroupName, next.appGroupName]);
  }

  // 7. Bare app name (last — most generic)
  if (current.appName !== next.appName) {
    pairs.push([current.appName, next.appName]);
  }

  return pairs;
}

function updateFileContent(filePath: string, replacements: Array<[string, string]>, dryRun: boolean): boolean {
  const original = readFileSync(filePath, 'utf-8');
  let content = original;

  for (const [from, to] of replacements) {
    content = content.replaceAll(from, to);
  }

  if (content === original) return false;

  if (!dryRun) {
    writeFileSync(filePath, content, 'utf-8');
  }
  return true;
}

function updatePackageJson(
  pkgPath: string,
  current: DerivedBrand,
  next: DerivedBrand,
  config: BrandingConfig,
  dryRun: boolean,
): boolean {
  const raw = readFileSync(pkgPath, 'utf-8');
  const pkg = JSON.parse(raw);
  let changed = false;

  // name
  if (pkg.name === current.appName || pkg.name === current.cliBinName) {
    pkg.name = next.appName;
    changed = true;
  }

  // bin
  if (pkg.bin && pkg.bin[current.cliBinName]) {
    const binPath = pkg.bin[current.cliBinName].replace(current.cliBinName, next.cliBinName);
    delete pkg.bin[current.cliBinName];
    pkg.bin[next.cliBinName] = binPath;
    changed = true;
  }

  // Optional overrides from branding.yaml
  if (config.version && config.version !== pkg.version) {
    pkg.version = config.version;
    changed = true;
  }
  if (config.description && config.description !== pkg.description) {
    pkg.description = config.description;
    changed = true;
  }
  if (config.author && config.author !== pkg.author) {
    pkg.author = config.author;
    changed = true;
  }
  if (config.license && config.license !== pkg.license) {
    pkg.license = config.license;
    changed = true;
  }
  if (config.keywords && JSON.stringify(config.keywords) !== JSON.stringify(pkg.keywords)) {
    pkg.keywords = config.keywords;
    changed = true;
  }

  if (changed && !dryRun) {
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  }

  return changed;
}

function interpolatePlaceholders(template: string, brand: DerivedBrand): string {
  return template
    .replaceAll('{{appGroupName}}', brand.appGroupName)
    .replaceAll('{{appName}}', brand.appName)
    .replaceAll('{{cliBinName}}', brand.cliBinName);
}

function renameFiles(
  renames: Array<{ from: string; to: string }>,
  rootDir: string,
  next: DerivedBrand,
  dryRun: boolean,
): string[] {
  const renamed: string[] = [];

  for (const entry of renames) {
    const fromPath = resolve(rootDir, entry.from);
    const toPath = resolve(rootDir, interpolatePlaceholders(entry.to, next));

    if (fromPath === toPath) continue;
    if (!existsSync(fromPath)) {
      console.warn(`  skip: ${entry.from} (not found)`);
      continue;
    }

    if (!dryRun) {
      renameSync(fromPath, toPath);
    }
    renamed.push(`${entry.from} → ${interpolatePlaceholders(entry.to, next)}`);
  }

  return renamed;
}

// ── Minimal glob implementation using node:fs ───────────────
function resolveGlobs(patterns: string[], rootDir: string): string[] {
  const { globSync: nodeGlob } = require('node:fs');
  const files = new Set<string>();

  for (const pattern of patterns) {
    try {
      const matches = nodeGlob(pattern, { cwd: rootDir });
      for (const match of matches) {
        files.add(resolve(rootDir, match as string));
      }
    } catch {
      // Fallback: treat as literal path
      const literal = resolve(rootDir, pattern);
      if (existsSync(literal)) {
        files.add(literal);
      }
    }
  }

  return [...files];
}

// ── Main ────────────────────────────────────────────────────
function main(): void {
  const dryRun = process.argv.includes('--dry-run');
  const rootDir = resolve(import.meta.dirname ?? __dirname, '..');
  const yamlPath = join(rootDir, 'scripts', 'branding.yaml');

  if (!existsSync(yamlPath)) {
    console.error('Error: scripts/branding.yaml not found.');
    process.exit(1);
  }

  const config = resolveBranding(yamlPath);
  const current = deriveBrand(CURRENT_APP_GROUP_NAME, CURRENT_APP_NAME);
  const next = deriveBrand(config.appGroupName, config.appName);

  // Check if anything changed
  if (current.appGroupName === next.appGroupName && current.appName === next.appName) {
    console.log('No brand changes detected (current values match branding.yaml).');
    return;
  }

  if (dryRun) {
    console.log('[DRY RUN] No files will be modified.\n');
  }

  console.log(`Rebranding: ${current.cliBinName} → ${next.cliBinName}`);
  console.log(`  Group: ${current.appGroupName} → ${next.appGroupName}`);
  console.log(`  Name:  ${current.appName} → ${next.appName}\n`);

  const replacements = buildReplacements(current, next);

  // Resolve files to update
  const filePatterns = config.files_to_update ?? ['src/**/*.ts', 'bin/**/*.js', 'package.json'];
  const files = resolveGlobs(filePatterns, rootDir);

  let updatedCount = 0;

  for (const filePath of files) {
    const isPackageJson = filePath.endsWith('package.json');

    if (isPackageJson) {
      const changed = updatePackageJson(filePath, current, next, config, dryRun);
      if (changed) {
        console.log(`  updated: package.json`);
        updatedCount++;
      }
    }

    const changed = updateFileContent(filePath, replacements, dryRun);
    if (changed) {
      const relative = filePath.replace(rootDir + '/', '');
      console.log(`  updated: ${relative}`);
      updatedCount++;
    }
  }

  // File renames
  const renames = config.files_to_rename ?? [];
  if (renames.length > 0) {
    const renamed = renameFiles(renames, rootDir, next, dryRun);
    for (const r of renamed) {
      console.log(`  renamed: ${r}`);
    }
  }

  // Update branding.ts itself (the source of truth)
  const brandingPath = join(rootDir, 'src', 'config', 'branding.ts');
  if (existsSync(brandingPath)) {
    const brandingContent = readFileSync(brandingPath, 'utf-8');
    let updated = brandingContent;
    updated = updated.replace(
      `const APP_GROUP_NAME = '${current.appGroupName}'`,
      `const APP_GROUP_NAME = '${next.appGroupName}'`,
    );
    updated = updated.replace(
      `const APP_NAME = '${current.appName}'`,
      `const APP_NAME = '${next.appName}'`,
    );
    if (updated !== brandingContent) {
      if (!dryRun) {
        writeFileSync(brandingPath, updated, 'utf-8');
      }
      console.log('  updated: src/config/branding.ts');
      updatedCount++;
    }
  }

  // Update this script's own CURRENT_* constants
  const selfPath = join(rootDir, 'scripts', 'rebrand.ts');
  if (existsSync(selfPath)) {
    const selfContent = readFileSync(selfPath, 'utf-8');
    let updated = selfContent;
    updated = updated.replace(
      `const CURRENT_APP_GROUP_NAME = '${current.appGroupName}'`,
      `const CURRENT_APP_GROUP_NAME = '${next.appGroupName}'`,
    );
    updated = updated.replace(
      `const CURRENT_APP_NAME = '${current.appName}'`,
      `const CURRENT_APP_NAME = '${next.appName}'`,
    );
    if (updated !== selfContent) {
      if (!dryRun) {
        writeFileSync(selfPath, updated, 'utf-8');
      }
      console.log('  updated: scripts/rebrand.ts (self)');
      updatedCount++;
    }
  }

  console.log(`\n${dryRun ? 'Would update' : 'Updated'} ${updatedCount} file(s).`);

  if (!dryRun) {
    console.log('\nDone! Remember to:');
    console.log('  1. Run `npm run build` to rebuild');
    console.log('  2. Run `npm test` to verify');
    console.log('  3. Update branding.yaml CURRENT_* if running rebrand again');
  }
}

main();
