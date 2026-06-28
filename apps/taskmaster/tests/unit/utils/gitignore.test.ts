import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureGitignoreEntry } from '../../../src/utils/gitignore.js';

describe('ensureGitignoreEntry', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'agentx-gitignore-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('creates .gitignore and adds entry when file does not exist', async () => {
    const added = await ensureGitignoreEntry(tmpDir);
    expect(added).toBe(true);

    const content = await readFile(join(tmpDir, '.gitignore'), 'utf-8');
    expect(content).toContain('.agentx/');
  });

  it('appends entry to existing .gitignore', async () => {
    await writeFile(join(tmpDir, '.gitignore'), 'node_modules/\n', 'utf-8');

    const added = await ensureGitignoreEntry(tmpDir);
    expect(added).toBe(true);

    const content = await readFile(join(tmpDir, '.gitignore'), 'utf-8');
    expect(content).toContain('node_modules/');
    expect(content).toContain('.agentx/');
  });

  it('returns false when entry already exists', async () => {
    await writeFile(join(tmpDir, '.gitignore'), '.agentx/\n', 'utf-8');

    const added = await ensureGitignoreEntry(tmpDir);
    expect(added).toBe(false);
  });

  it('handles .gitignore without trailing newline', async () => {
    await writeFile(join(tmpDir, '.gitignore'), 'node_modules/', 'utf-8');

    const added = await ensureGitignoreEntry(tmpDir);
    expect(added).toBe(true);

    const content = await readFile(join(tmpDir, '.gitignore'), 'utf-8');
    // Should add a newline separator before the entry
    expect(content).toBe('node_modules/\n.agentx/\n');
  });

  it('handles empty .gitignore', async () => {
    await writeFile(join(tmpDir, '.gitignore'), '', 'utf-8');

    const added = await ensureGitignoreEntry(tmpDir);
    expect(added).toBe(true);

    const content = await readFile(join(tmpDir, '.gitignore'), 'utf-8');
    expect(content).toBe('.agentx/\n');
  });

  it('detects entry with surrounding whitespace', async () => {
    await writeFile(join(tmpDir, '.gitignore'), '  .agentx/  \n', 'utf-8');

    const added = await ensureGitignoreEntry(tmpDir);
    expect(added).toBe(false);
  });
});
