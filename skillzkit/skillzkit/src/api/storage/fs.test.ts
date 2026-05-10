import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FilesystemCatalogStorage, findSkillzkitPackageRoot } from './fs.js';

const __filename = fileURLToPath(import.meta.url);
const packageRoot = findSkillzkitPackageRoot(dirname(__filename));

/**
 * These tests exercise the fs backend against THIS repo's
 * catalog.json. The npm test script runs `npm run catalog && vitest`,
 * so the catalog is freshly generated before tests run — the real
 * commands/skills/workflows are present.
 */
describe('FilesystemCatalogStorage', () => {
  const fs = new FilesystemCatalogStorage(packageRoot);

  it('findSkillzkitPackageRoot resolves the actual repo root', () => {
    expect(packageRoot).toMatch(/apps\/skillzkit$/);
  });

  it('getIndex returns the real catalog without bodies', async () => {
    const index = await fs.getIndex();
    expect(index.version).toBe(1);
    expect(index.commands.length).toBeGreaterThan(100); // ~183 in the real catalog
    expect(index.skills.length).toBeGreaterThan(0);
    expect(index.workflows.length).toBeGreaterThan(0);
    // Summary entries should not carry the body field
    expect(index.commands[0]).not.toHaveProperty('body');
  });

  it('getCommand returns a known command with body intact', async () => {
    // core:tools:biome is a stable known slug in the catalog
    const cmd = await fs.getCommand('core:tools:biome');
    expect(cmd).not.toBe(null);
    expect(cmd!.slug).toBe('core:tools:biome');
    expect(cmd!.body.length).toBeGreaterThan(0);
  });

  it('getCommand returns null for unknown slug', async () => {
    expect(await fs.getCommand('does:not:exist')).toBe(null);
  });

  it('listVersions returns a single entry for known slugs', async () => {
    const versions = await fs.listCommandVersions('core:tools:biome');
    expect(versions).toHaveLength(1);
    expect(versions[0].promoted).toBe(true);
  });

  it('listVersions returns empty array for unknown slug', async () => {
    expect(await fs.listCommandVersions('does:not:exist')).toEqual([]);
  });

  it('getCommandVersion accepts the package version, rejects others', async () => {
    const versions = await fs.listCommandVersions('core:tools:biome');
    const realVersion = versions[0].version;
    expect(await fs.getCommandVersion('core:tools:biome', realVersion)).not.toBe(null);
    expect(await fs.getCommandVersion('core:tools:biome', '9.9.9')).toBe(null);
  });

  it('write methods throw with a clear error', async () => {
    const fakeAuthor = { id: 'u_x', displayName: 'x' };
    await expect(
      fs.putCommand({
        command: {
          slug: 'x',
          path: 'x.md',
          kind: 'command',
          description: '',
          references: [],
          referencedBy: [],
          body: '',
          frontmatter: {},
        },
        version: '1',
        author: fakeAuthor,
      }),
    ).rejects.toThrow(/read-only/);
    await expect(fs.promoteCommand('x', '1')).rejects.toThrow(/read-only/);
  });
});
