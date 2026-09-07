import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { type Browser, type BrowserContext, chromium } from 'playwright';
import { StorybrokrError } from '../lib/errors.js';
import type { Viewport } from '../types.js';

export interface BrowserStatus {
  installed: boolean;
  executablePath: string;
}

/** Where Playwright expects its Chromium, and whether it is there. Never installs. */
export function browserStatus(): BrowserStatus {
  const executablePath = chromium.executablePath();
  return { installed: existsSync(executablePath), executablePath };
}

/**
 * Runs Playwright's own installer for Chromium. Resolved from storybrokr's install location so a
 * global `npm i -g` works; `playwright/package.json` is an exported path, `cli.js` sits beside it.
 */
function defaultInstall(onLine: (line: string) => void): Promise<number> {
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve('playwright/package.json')), 'cli.js');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'install', 'chromium'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const feed = (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) onLine(line);
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

export interface BrowserPoolOptions {
  idleMinutes: number; // 0 = never close on idle
  launch?: () => Promise<Browser>;
  isInstalled?: () => boolean;
  install?: (onLine: (line: string) => void) => Promise<number>;
  log?: (line: string) => void;
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const TAIL = 20;

/**
 * One headless Chromium per daemon, launched on first use. Each acquire() returns a fresh
 * BrowserContext; the pool watches the context's 'close' event to know when it is idle.
 */
export class BrowserPool {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private installing: Promise<void> | null = null;
  private open = 0;
  private idleTimer: unknown = null;
  private readonly opts: Required<BrowserPoolOptions>;

  constructor(opts: BrowserPoolOptions) {
    this.opts = {
      launch: () => chromium.launch({ headless: true }),
      isInstalled: () => browserStatus().installed,
      install: defaultInstall,
      log: () => {},
      setTimer: (cb, ms) => {
        const t = setTimeout(cb, ms);
        t.unref();
        return t;
      },
      clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
      ...opts,
    };
  }

  get openContexts(): number {
    return this.open;
  }

  async acquire(viewport?: Viewport): Promise<BrowserContext> {
    const browser = await this.ensureBrowser();
    const context = await browser.newContext(viewport ? { viewport } : {});
    this.open++;
    if (this.idleTimer !== null) {
      this.opts.clearTimer(this.idleTimer);
      this.idleTimer = null;
    }
    context.on('close', () => this.release());
    return context;
  }

  async close(): Promise<void> {
    if (this.idleTimer !== null) {
      this.opts.clearTimer(this.idleTimer);
      this.idleTimer = null;
    }
    const b = this.browser;
    this.browser = null;
    if (b) await b.close().catch(() => {});
  }

  private release(): void {
    this.open = Math.max(0, this.open - 1);
    if (this.open > 0 || this.opts.idleMinutes <= 0 || !this.browser) return;
    this.idleTimer = this.opts.setTimer(() => {
      this.idleTimer = null;
      if (this.open === 0) void this.close();
    }, this.opts.idleMinutes * 60_000);
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser) return this.browser;
    if (!this.launching) {
      this.launching = (async () => {
        await this.ensureInstalled();
        let b: Browser;
        try {
          b = await this.opts.launch();
        } catch (err) {
          throw new StorybrokrError(
            'BROWSER_UNAVAILABLE',
            `could not launch chromium: ${(err as Error).message}`,
          );
        }
        b.on('disconnected', () => {
          if (this.browser === b) this.browser = null;
        });
        this.browser = b;
        return b;
      })().finally(() => {
        this.launching = null;
      });
    }
    return this.launching;
  }

  private async ensureInstalled(): Promise<void> {
    if (this.opts.isInstalled()) return;
    if (!this.installing) {
      this.installing = (async () => {
        const tail: string[] = [];
        this.opts.log('chromium not installed; running `playwright install chromium`');
        const code = await this.opts.install((line) => {
          tail.push(line);
          if (tail.length > TAIL) tail.shift();
          this.opts.log(line);
        });
        if (code !== 0) {
          throw new StorybrokrError(
            'BROWSER_UNAVAILABLE',
            `playwright install chromium exited with code ${code}`,
            tail,
          );
        }
      })().finally(() => {
        this.installing = null;
      });
    }
    return this.installing;
  }
}
