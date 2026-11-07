import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureGitignoreEntry } from '../../../src/utils/gitignore.js';

describe('ensureGitignoreEntry', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'helmsmith-gitignore-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('creates .gitignore and adds entry when file does not exist', async () => {
    const added = await ensureGitignoreEntry(tmpDir);
    expect(added).toBe(true);

    const content = await readFile(join(tmpDir, '.gitignore'), 'utf-8');
    expect(content).toBe('.helmsmith/taskmaster/\n');
  });

  it('ignores only its own subdirectory, never the shared .helmsmith/ (workbrokr commits .helmsmith/hooks)', async () => {
    await ensureGitignoreEntry(tmpDir);

    const lines = (await readFile(join(tmpDir, '.gitignore'), 'utf-8')).split('\n');
    expect(lines).not.toContain('.helmsmith/');
    expect(lines).not.toContain('.helmsmith');
  });

  it('appends entry to existing .gitignore', async () => {
    await writeFile(join(tmpDir, '.gitignore'), 'node_modules/\n', 'utf-8');

    const added = await ensureGitignoreEntry(tmpDir);
    expect(added).toBe(true);

    const content = await readFile(join(tmpDir, '.gitignore'), 'utf-8');
    expect(content).toBe('node_modules/\n.helmsmith/taskmaster/\n');
  });

  it('returns false when entry already exists', async () => {
    await writeFile(join(tmpDir, '.gitignore'), '.helmsmith/taskmaster/\n', 'utf-8');

    const added = await ensureGitignoreEntry(tmpDir);
    expect(added).toBe(false);
  });

  it('handles .gitignore without trailing newline', async () => {
    await writeFile(join(tmpDir, '.gitignore'), 'node_modules/', 'utf-8');

    const added = await ensureGitignoreEntry(tmpDir);
    expect(added).toBe(true);

    const content = await readFile(join(tmpDir, '.gitignore'), 'utf-8');
    // Should add a newline separator before the entry
    expect(content).toBe('node_modules/\n.helmsmith/taskmaster/\n');
  });

  it('handles empty .gitignore', async () => {
    await writeFile(join(tmpDir, '.gitignore'), '', 'utf-8');

    const added = await ensureGitignoreEntry(tmpDir);
    expect(added).toBe(true);

    const content = await readFile(join(tmpDir, '.gitignore'), 'utf-8');
    expect(content).toBe('.helmsmith/taskmaster/\n');
  });

  it('detects entry with surrounding whitespace', async () => {
    await writeFile(join(tmpDir, '.gitignore'), '  .helmsmith/taskmaster/  \n', 'utf-8');

    const added = await ensureGitignoreEntry(tmpDir);
    expect(added).toBe(false);
  });
});
