import { afterAll, describe, expect, it } from 'vitest';
import type { InstanceRecord } from '../../src/types.js';
import { makeHome, runCli, runJson } from './helpers.js';

const HOST = process.env.STORYBROKR_E2E_HOST;
const COMPONENT =
  process.env.STORYBROKR_E2E_COMPONENT ?? 'components/core/organisms/calendar/section';

describe.skipIf(!HOST)('external host (opt-in)', () => {
  const { home, cleanup } = makeHome();
  afterAll(async () => {
    await runCli(['daemon', 'stop'], { home }).catch(() => {});
    cleanup();
  });

  it(`brokers ${COMPONENT} from ${HOST}`, async () => {
    const t0 = Date.now();
    const rec = await runJson<InstanceRecord>(['up', COMPONENT, '--host', HOST as string], {
      home,
    });
    console.log(
      `external host ready in ${((Date.now() - t0) / 1000).toFixed(1)}s with ${rec.stories.length} stories`,
    );
    expect(rec.status).toBe('ready');
    expect(rec.stories.length).toBeGreaterThan(0);
    await runCli(['down', rec.id], { home });
  });
});
