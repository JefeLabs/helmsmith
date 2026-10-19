import { createServer } from 'node:net';
import { StorybrokrError } from './errors.js';

/** A bind that fails with EADDRINUSE means busy; any other failure (no IPv6, etc.) does not. */
function bindOk(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (err: NodeJS.ErrnoException) => resolve(err.code !== 'EADDRINUSE'));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

/** Free only when loopback, the IPv4 wildcard and the IPv6 wildcard can all bind: on macOS a
 * 127.0.0.1 bind succeeds while :: (where Storybook listens) or 0.0.0.0 is held. */
async function canBind(port: number): Promise<boolean> {
  for (const host of ['127.0.0.1', '0.0.0.0', '::']) if (!(await bindOk(port, host))) return false;
  return true;
}

export async function findFreePort(
  start: number,
  end: number,
  reserved: Set<number>,
): Promise<number> {
  for (let port = start; port <= end; port++) {
    if (reserved.has(port)) continue;
    if (await canBind(port)) return port;
  }
  throw new StorybrokrError('NO_FREE_PORT', `no free port in ${start}-${end}`);
}
