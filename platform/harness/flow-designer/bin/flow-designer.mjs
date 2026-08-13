#!/usr/bin/env node
import { dirname, join } from 'node:path';
/**
 * `npx @helmsmith/flow-designer [--port 5175] [--harness http://127.0.0.1:8787]`
 *
 * Serves the built designer and proxies its `/harness` calls to a
 * running harness (or a controlplane implementing the same
 * `/v1/catalog` wire shape). HARNESS_URL env works too.
 */
import { fileURLToPath } from 'node:url';
import { createDesignerServer } from './serve.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const port = Number(flag('port', '5175'));
const harnessUrl = flag('harness', process.env.HARNESS_URL ?? 'http://127.0.0.1:8787');
// Loopback by default: the /harness proxy forwards approval actor
// headers to a harness whose trust model assumes LOCAL access —
// exposing it network-wide is an explicit operator decision
// (--host 0.0.0.0), never an accident.
const host = flag('host', '127.0.0.1');
const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

createDesignerServer({ distDir, harnessUrl }).listen(port, host, () => {
  console.log(`flow-designer  →  http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  console.log(`harness proxy  →  ${harnessUrl}  (override: --harness <url> or HARNESS_URL)`);
  if (host !== '127.0.0.1')
    console.log(`bound to ${host} — the harness proxy is network-reachable`);
});
