import { createServer } from 'node:net';
import { StorybrokrError } from './errors.js';

function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
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
