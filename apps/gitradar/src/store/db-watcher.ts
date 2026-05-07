import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';

const DEBOUNCE_MS = 150;

/**
 * Watches the SQLite database directory for filesystem changes
 * and signals the TUI to re-check for data updates immediately,
 * instead of waiting for the next poll interval.
 *
 * In WAL mode, writes land in `.db-wal` before checkpointing to
 * `.db`, so we watch the whole directory and filter by extension.
 *
 * Usage:
 *   const watcher = new DbWatcher(getSQLitePath());
 *   watcher.start();
 *   const signal = watcher.createSignal(); // pass to readKeyWithTimeout
 *   // ... later ...
 *   watcher.close();
 */
export class DbWatcher {
  private watcher: FSWatcher | null = null;
  private controller: AbortController | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly dir: string;
  private readonly basename: string;

  constructor(dbPath: string) {
    this.dir = path.dirname(dbPath);
    this.basename = path.basename(dbPath);
  }

  /** Start watching the database directory for changes. */
  start(): void {
    if (this.watcher) return;

    try {
      this.watcher = watch(this.dir, (_event, filename) => {
        // filename can be null on some platforms; ignore those events
        if (!filename) return;
        if (
          filename === this.basename ||
          filename === this.basename + '-wal' ||
          filename === this.basename + '-shm'
        ) {
          this.onDbChange();
        }
      });

      // Gracefully ignore watcher errors (e.g. directory deleted)
      this.watcher.on('error', () => {
        this.close();
      });
    } catch {
      // fs.watch may throw on unsupported platforms — fall back to polling
    }
  }

  /**
   * Create an AbortSignal that will be aborted when a database
   * change is detected. Pass this to `readKeyWithTimeout`.
   *
   * Each call creates a fresh controller (the previous one may
   * already be aborted from the last change notification).
   */
  createSignal(): AbortSignal {
    this.controller = new AbortController();
    return this.controller.signal;
  }

  /** Stop watching and clean up resources. */
  close(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.controller = null;
  }

  private onDbChange(): void {
    // Debounce: a single write triggers many filesystem events
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.controller?.abort();
    }, DEBOUNCE_MS);
  }
}
