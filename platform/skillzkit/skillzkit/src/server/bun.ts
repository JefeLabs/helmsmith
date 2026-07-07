/**
 * Bun runtime entry. Used by `skillzkit serve` for local dev AND for
 * controlplane-hosted Docker deployments — Bun's native HTTP server
 * is fast, has zero dependencies, and the project already includes
 * Bun for the TUI.
 *
 * Configure via env vars (see server/config.ts):
 *   SKILLZKIT_STORAGE   — backend selector (default: fs:auto)
 *   PORT                — listen port (default: 3000)
 *
 * Container build: a Dockerfile in this repo's root sets up Bun and
 * runs this file. The same image works for local dev when run with
 * `bun server/bun.ts`.
 */

import { createApp } from './app.js';
import { loadServerConfig } from './config.js';

const config = await loadServerConfig();
const app = createApp({ storage: config.storage, writable: config.writable });

const storageDesc = process.env.SKILLZKIT_STORAGE ?? 'fs:auto';
console.log(
  `skillzkit-api listening on :${config.port}  (storage=${storageDesc}, writable=${config.writable})`,
);

// @ts-expect-error — Bun is a runtime global, not in @types/node
Bun.serve({
  port: config.port,
  fetch: app.fetch,
});
