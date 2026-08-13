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
const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

createDesignerServer({ distDir, harnessUrl }).listen(port, () => {
  console.log(`flow-designer  →  http://localhost:${port}`);
  console.log(`harness proxy  →  ${harnessUrl}  (override: --harness <url> or HARNESS_URL)`);
});
