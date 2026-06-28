import { describe, expect, it } from 'vitest';
import { checkTool, getPath, getVersion, isInstalled } from './tool-checker.js';

/**
 * These tests exercise the tool-checker against `node` itself — every
 * machine running this test suite has a Node binary on PATH (vitest
 * couldn't be running otherwise), so it's a reliable target.
 */

describe('tool-checker', () => {
  it('isInstalled returns true for node', async () => {
    const present = await isInstalled('node');
    expect(present).toBe(true);
  });

  it('isInstalled returns false for a definitely-absent binary', async () => {
    const present = await isInstalled('definitely-not-a-real-binary-xyz123');
    expect(present).toBe(false);
  });

  it('getPath returns an absolute path for node', async () => {
    const path = await getPath('node');
    expect(path).toBeTruthy();
    expect(path).toMatch(/node$/);
  });

  it("getVersion parses node's version string", async () => {
    const version = await getVersion('node');
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('checkTool returns the full result shape for node', async () => {
    const result = await checkTool('node');
    expect(result.installed).toBe(true);
    expect(result.path).toBeTruthy();
    expect(result.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('checkTool reports not-installed cleanly', async () => {
    const result = await checkTool('definitely-not-a-real-binary-xyz123');
    expect(result.installed).toBe(false);
    expect(result.path).toBeNull();
    expect(result.version).toBeNull();
  });
});
