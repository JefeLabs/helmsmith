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

describe('S6: wildcard listeners', () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
    servers.length = 0;
  });
  for (const addr of ['0.0.0.0', '::']) {
    it(`treats a port held on ${addr} as busy`, async () => {
      const s = await new Promise<Server>((res, rej) => {
        const srv = createServer();
        srv.once('error', rej);
        srv.listen(6197, addr, () => res(srv));
      });
      servers.push(s);
      expect(await findFreePort(6197, 6198, new Set())).toBe(6198);
    });
  }
});
