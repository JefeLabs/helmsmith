import { describe, expect, it, vi } from 'vitest';
import { StorybrokrError } from '../lib/errors.js';
import { BrowserPool } from './browser.js';

type Listener = () => void;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function fakeBrowser() {
  const contexts: { close: () => Promise<void> }[] = [];
  let disconnected: Listener | undefined;
  const browser = {
    on: (event: string, cb: Listener) => {
      if (event === 'disconnected') disconnected = cb;
    },
    newContext: vi.fn(async () => {
      let onClose: Listener | undefined;
      const ctx = {
        on: (event: string, cb: Listener) => {
          if (event === 'close') onClose = cb;
        },
        close: async () => onClose?.(),
      };
      contexts.push(ctx);
      return ctx;
    }),
    close: vi.fn(async () => disconnected?.()),
  };
  return { browser, contexts };
}

function pool(over: Partial<ConstructorParameters<typeof BrowserPool>[0]> = {}) {
  const { browser, contexts } = fakeBrowser();
  const launch = vi.fn(async () => browser as never);
  const install = vi.fn(async (onLine: (l: string) => void) => {
    onLine('downloading chromium');
    return 0;
  });
  const timers: { cb: () => void; ms: number }[] = [];
  const p = new BrowserPool({
    idleMinutes: 10,
    launch,
    isInstalled: () => true,
    install,
    log: () => {},
    setTimer: (cb, ms) => {
      timers.push({ cb, ms });
      return timers.length;
    },
    clearTimer: () => {},
    ...over,
  });
  return { p, browser, contexts, launch, install, timers };
}

describe('BrowserPool', () => {
  it('launches once and hands out a fresh context per acquire', async () => {
    const { p, launch, browser } = pool();
    const a = await p.acquire();
    const b = await p.acquire({ width: 640, height: 480 });
    expect(launch).toHaveBeenCalledTimes(1);
    expect(browser.newContext).toHaveBeenCalledTimes(2);
    expect(browser.newContext).toHaveBeenLastCalledWith({ viewport: { width: 640, height: 480 } });
    expect(a).not.toBe(b);
    expect(p.openContexts).toBe(2);
  });

  it('runs the installer once when chromium is missing, even for concurrent acquires', async () => {
    let installed = false;
    const { p, launch } = pool({
      isInstalled: () => installed,
      install: async (onLine) => {
        onLine('fetching');
        installed = true;
        return 0;
      },
    });
    await Promise.all([p.acquire(), p.acquire()]);
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('maps a failed install to BROWSER_UNAVAILABLE with the installer tail, and retries next time', async () => {
    let attempts = 0;
    const { p } = pool({
      isInstalled: () => attempts > 0,
      install: async (onLine) => {
        attempts++;
        onLine('line 1');
        onLine('line 2');
        return 1;
      },
    });
    const err = await p.acquire().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StorybrokrError);
    expect((err as StorybrokrError).code).toBe('BROWSER_UNAVAILABLE');
    expect((err as StorybrokrError).logTail).toEqual(['line 1', 'line 2']);
    await expect(p.acquire()).resolves.toBeDefined(); // isInstalled is now true → no second install
  });

  it('maps a launch failure to BROWSER_UNAVAILABLE', async () => {
    const { p } = pool({
      launch: async () => {
        throw new Error('no display');
      },
    });
    const err = await p.acquire().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StorybrokrError);
    expect((err as StorybrokrError).code).toBe('BROWSER_UNAVAILABLE');
    expect((err as StorybrokrError).message).toMatch(/no display/);
  });

  it('does not let the idle timer kill the browser while a second acquire() is in flight', async () => {
    const { p, browser, contexts, timers } = pool({ idleMinutes: 2 });
    await p.acquire();
    await contexts[0].close(); // arms the idle timer
    expect(timers).toHaveLength(1);

    const contextDeferred = deferred<{
      on: (event: string, cb: Listener) => void;
      close: () => Promise<void>;
    }>();
    browser.newContext.mockImplementationOnce(() => contextDeferred.promise);

    const acquirePromise = p.acquire();
    timers[0].cb(); // the idle timer fires while newContext() is still pending
    await new Promise((r) => setImmediate(r));
    expect(browser.close).not.toHaveBeenCalled();

    let onClose: Listener | undefined;
    contextDeferred.resolve({
      on: (event, cb) => {
        if (event === 'close') onClose = cb;
      },
      close: async () => onClose?.(),
    });

    await expect(acquirePromise).resolves.toBeDefined();
  });

  it('does not orphan the browser process when close() runs during an in-flight launch', async () => {
    const launchDeferred = deferred<never>();
    const { p, browser } = pool({ launch: vi.fn(() => launchDeferred.promise) });

    const acquirePromise = p.acquire().catch((e: unknown) => e);
    const closePromise = p.close();
    launchDeferred.resolve(browser as never);

    await Promise.all([acquirePromise, closePromise]);
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(p.openContexts).toBe(0);
  });

  it('arms the idle timer when the last context closes and closes the browser when it fires', async () => {
    const { p, timers, browser, contexts } = pool({ idleMinutes: 2 });
    await p.acquire();
    await contexts[0].close();
    expect(p.openContexts).toBe(0);
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(120_000);
    timers[0].cb();
    await new Promise((r) => setImmediate(r));
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('never arms the idle timer when idleMinutes is 0', async () => {
    const { p, timers, contexts } = pool({ idleMinutes: 0 });
    await p.acquire();
    await contexts[0].close();
    expect(timers).toHaveLength(0);
  });

  it('relaunches after the browser disconnects, and close() is idempotent', async () => {
    const { p, launch, browser } = pool();
    await p.acquire();
    await browser.close(); // fires 'disconnected'
    await p.acquire();
    expect(launch).toHaveBeenCalledTimes(2);
    await p.close();
    await p.close();
  });

  it('resets openContexts to 0 when the browser disconnects without its contexts closing', async () => {
    const { p, browser } = pool();
    await p.acquire();
    expect(p.openContexts).toBe(1);
    await browser.close(); // fires 'disconnected' without the context's 'close' event firing
    expect(p.openContexts).toBe(0);
  });
});
