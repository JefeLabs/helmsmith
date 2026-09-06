import { createRequire } from 'node:module';
import { afterAll, describe, expect, it } from 'vitest';
import type { InstanceRecord } from '../../src/types.js';
import { FIXTURE_HOST, makeHome, runCli, runJson } from './helpers.js';

const enabled = process.env.STORYBROKR_E2E_RENDER === '1';

describe.skipIf(!enabled)('headless render (opt-in)', () => {
  const { home, cleanup } = makeHome();
  afterAll(async () => {
    await runCli(['daemon', 'stop'], { home }).catch(() => {});
    cleanup();
  });

  it('renders the Panel story with its children inside the ephemeral instance', async () => {
    const require = createRequire(
      process.env.STORYBROKR_PLAYWRIGHT_DIR
        ? `${process.env.STORYBROKR_PLAYWRIGHT_DIR}/`
        : import.meta.url,
    );
    const { chromium } = require('playwright') as typeof import('playwright');
    const rec = await runJson<InstanceRecord>(
      ['up', 'src/components/Panel', '--host', FIXTURE_HOST],
      { home },
    );
    const story = rec.stories.find((s) => s.id === 'organisms-panel--default');
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(story?.iframeUrl ?? '');
    // Wait for real content, not a Suspense fallback: the button text proves the child rendered.
    await page.waitForFunction(
      () => document.querySelector('#storybook-root button')?.textContent === 'Go',
      null,
      { timeout: 30_000 },
    );
    expect(await page.textContent('#storybook-root h2')).toContain('Panel');
    await browser.close();
    await runCli(['down', rec.id], { home });
  });
});
