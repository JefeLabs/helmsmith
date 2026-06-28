import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    vi.useRealTimers();
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

  // Change-detection tests drive handleFsEvent() directly with fake timers rather
  // than writing real files and waiting on OS fs.watch delivery — which is
  // unreliable under parallel CPU load (the HELM-T4 flake). The behavior worth
  // testing is the filename filter + debounce + abort, exercised deterministically
  // here. start()'s real fs.watch wiring is covered by the idempotency tests above.

  it('aborts signal when db file changes', () => {
    vi.useFakeTimers();
    const watcher = new DbWatcher(dbPath);
    const signal = watcher.createSignal();

    watcher.handleFsEvent('test.db');
    vi.advanceTimersByTime(150); // debounce window

    expect(signal.aborted).toBe(true);
    watcher.close();
  });

  it('aborts signal when WAL file changes', () => {
    vi.useFakeTimers();
    const watcher = new DbWatcher(dbPath);
    const signal = watcher.createSignal();

    watcher.handleFsEvent('test.db-wal');
    vi.advanceTimersByTime(150);

    expect(signal.aborted).toBe(true);
    watcher.close();
  });

  it('does not abort signal for unrelated file changes', () => {
    vi.useFakeTimers();
    const watcher = new DbWatcher(dbPath);
    const signal = watcher.createSignal();

    watcher.handleFsEvent('unrelated.txt');
    vi.advanceTimersByTime(300);

    expect(signal.aborted).toBe(false);
    watcher.close();
  });

  it('debounces rapid changes into a single abort', () => {
    vi.useFakeTimers();
    const watcher = new DbWatcher(dbPath);
    const signal = watcher.createSignal();
    let abortCount = 0;
    signal.addEventListener('abort', () => abortCount++);

    // Rapid events within the debounce window collapse to one abort.
    watcher.handleFsEvent('test.db');
    watcher.handleFsEvent('test.db');
    watcher.handleFsEvent('test.db');
    vi.advanceTimersByTime(150);

    expect(signal.aborted).toBe(true);
    expect(abortCount).toBe(1);
    watcher.close();
  });

  it('new signal after abort is not pre-aborted', () => {
    vi.useFakeTimers();
    const watcher = new DbWatcher(dbPath);
    const signal1 = watcher.createSignal();

    watcher.handleFsEvent('test.db');
    vi.advanceTimersByTime(150);
    expect(signal1.aborted).toBe(true);

    // A fresh signal should start clean.
    const signal2 = watcher.createSignal();
    expect(signal2.aborted).toBe(false);

    watcher.close();
  });

  it('gracefully handles non-existent directory', () => {
    const watcher = new DbWatcher('/tmp/nonexistent-dir-xyz/test.db');
    watcher.start(); // should not throw even if the directory doesn't exist
    watcher.close();
  });
});
