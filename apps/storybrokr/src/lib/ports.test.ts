import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { StorybrokrError } from './errors.js';
import { findFreePort } from './ports.js';

function occupy(port: number): Promise<Server> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(port, '127.0.0.1', () => res(s));
  });
}

describe('findFreePort', () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
    servers.length = 0;
  });

  it('skips reserved ports and ports something else is listening on', async () => {
    const busy = await occupy(6191);
    servers.push(busy);
    const port = await findFreePort(6190, 6193, new Set([6190]));
    expect(port).toBe(6192);
  });

  it('throws NO_FREE_PORT when the range is exhausted', async () => {
    await expect(findFreePort(6195, 6195, new Set([6195]))).rejects.toBeInstanceOf(StorybrokrError);
    await expect(findFreePort(6195, 6195, new Set([6195]))).rejects.toMatchObject({
      code: 'NO_FREE_PORT',
    });
  });
});
