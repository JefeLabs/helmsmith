import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DbWatcher } from '../store/db-watcher.js';

describe('DbWatcher', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'dbwatcher-test-'));
    dbPath = join(tempDir, 'test.db');
    // Create the db file so the directory exists
    writeFileSync(dbPath, '');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates an AbortSignal via createSignal()', () => {
    const watcher = new DbWatcher(dbPath);
    const signal = watcher.createSignal();
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    watcher.close();
  });

  it('each createSignal() returns a fresh signal', () => {
    const watcher = new DbWatcher(dbPath);
    const signal1 = watcher.createSignal();
    const signal2 = watcher.createSignal();
    expect(signal1).not.toBe(signal2);
    watcher.close();
  });

  it('start() is idempotent', () => {
    const watcher = new DbWatcher(dbPath);
    watcher.start();
    watcher.start(); // should not throw
    watcher.close();
  });

  it('close() is safe to call multiple times', () => {
    const watcher = new DbWatcher(dbPath);
    watcher.start();
    watcher.close();
    watcher.close(); // should not throw
  });

  it('close() without start() does not throw', () => {
    const watcher = new DbWatcher(dbPath);
    watcher.close();
  });

  it('aborts signal when db file changes', async () => {
    const watcher = new DbWatcher(dbPath);
    watcher.start();
    const signal = watcher.createSignal();

    // Write to the db file to trigger a change
    writeFileSync(dbPath, 'updated');

    // Wait for debounce (150ms) + some margin
    await new Promise((r) => setTimeout(r, 300));

    expect(signal.aborted).toBe(true);
    watcher.close();
  });

  it('aborts signal when WAL file changes', async () => {
    const watcher = new DbWatcher(dbPath);
    watcher.start();
    const signal = watcher.createSignal();

    // Write a WAL file
    writeFileSync(dbPath + '-wal', 'wal data');

    await new Promise((r) => setTimeout(r, 300));

    expect(signal.aborted).toBe(true);
    watcher.close();
  });

  it('does not abort signal for unrelated file changes', async () => {
    const watcher = new DbWatcher(dbPath);
    watcher.start();

    // Wait for macOS to flush any stale events from the initial file creation
    await new Promise((r) => setTimeout(r, 200));

    // Now create a fresh signal after stale events have been consumed
    const signal = watcher.createSignal();

    // Write an unrelated file in the same directory
    writeFileSync(join(tempDir, 'unrelated.txt'), 'hello');

    await new Promise((r) => setTimeout(r, 300));

    expect(signal.aborted).toBe(false);
    watcher.close();
  });

  it('debounces rapid changes into a single abort', async () => {
    const watcher = new DbWatcher(dbPath);
    watcher.start();
    const signal = watcher.createSignal();
    let abortCount = 0;
    signal.addEventListener('abort', () => abortCount++);

    // Rapid writes
    writeFileSync(dbPath, 'a');
    writeFileSync(dbPath, 'b');
    writeFileSync(dbPath, 'c');

    await new Promise((r) => setTimeout(r, 300));

    expect(signal.aborted).toBe(true);
    expect(abortCount).toBe(1);
    watcher.close();
  });

  it('new signal after abort is not pre-aborted', async () => {
    const watcher = new DbWatcher(dbPath);
    watcher.start();
    const signal1 = watcher.createSignal();

    writeFileSync(dbPath, 'trigger');
    await new Promise((r) => setTimeout(r, 300));
    expect(signal1.aborted).toBe(true);

    // Create a fresh signal — it should start clean
    const signal2 = watcher.createSignal();
    expect(signal2.aborted).toBe(false);

    watcher.close();
  });

  it('gracefully handles non-existent directory', () => {
    const watcher = new DbWatcher('/tmp/nonexistent-dir-xyz/test.db');
    // start() should not throw even if the directory doesn't exist
    watcher.start();
    watcher.close();
  });
});
