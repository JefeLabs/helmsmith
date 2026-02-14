import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootstrapHome } from '../src/utils/home.js';
import { readDefaults, writeDefaults, defaultsExist } from '../src/utils/defaults.js';

const TEST_DIR = join(tmpdir(), `agentx-test-defaults-${Date.now()}`);

describe('defaults manager', () => {
  beforeEach(async () => {
    process.env.AGENTX_USERDATA = TEST_DIR;
    await bootstrapHome();
  });

  afterEach(() => {
    delete process.env.AGENTX_USERDATA;
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('returns empty object when defaults.yaml does not exist', async () => {
    expect(defaultsExist()).toBe(false);
    const defaults = await readDefaults();
    expect(defaults).toEqual({});
  });

  it('writes and reads defaults', async () => {
    await writeDefaults({ model: 'gpt-4o', style: 'task-only' });

    expect(defaultsExist()).toBe(true);
    const defaults = await readDefaults();
    expect(defaults.model).toBe('gpt-4o');
    expect(defaults.style).toBe('task-only');
  });

  it('merges partial updates (last-used-wins)', async () => {
    await writeDefaults({ model: 'gpt-4o', style: 'task-only' });
    await writeDefaults({ style: 'agile-full' });

    const defaults = await readDefaults();
    expect(defaults.model).toBe('gpt-4o'); // preserved
    expect(defaults.style).toBe('agile-full'); // updated
  });

  it('merges thresholds correctly', async () => {
    await writeDefaults({ thresholds: { expand: 5, flag: 8 } });
    await writeDefaults({ thresholds: { expand: 3 } });

    const defaults = await readDefaults();
    expect(defaults.thresholds?.expand).toBe(3);
    expect(defaults.thresholds?.flag).toBe(8);
  });

  it('handles skills array', async () => {
    await writeDefaults({ skills: ['backend', 'frontend'] });

    const defaults = await readDefaults();
    expect(defaults.skills).toEqual(['backend', 'frontend']);
  });
});
