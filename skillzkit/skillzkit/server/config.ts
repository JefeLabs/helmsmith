/**
 * Server configuration — parses environment variables to choose the
 * storage backend and other runtime knobs. Keeps deploy-time
 * concerns out of the Hono app definition so the same `app` works
 * across Bun, Lambda, and (future) other runtimes.
 *
 * Storage selection via `SKILLZKIT_STORAGE`:
 *
 *   memory                   — in-process, ephemeral. Tests + dev default.
 *   fs:<path>                — read-only, points at a skillzkit repo.
 *                              Used by `skillzkit serve` against the
 *                              local working tree.
 *   fs-persistent:<path>     — read+write, Docker-volume-friendly.
 *                              Backend for controlplane-hosted deploys.
 *   s3:<bucket>              — read+write, AWS S3. Production serverless.
 *
 * Other env vars:
 *
 *   SKILLZKIT_PACKAGE_ROOT   — overrides auto-detected package root for
 *                              the fs backend (useful in containers).
 *   PORT                     — listening port for long-running servers.
 *                              Defaults to 3000.
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FilesystemCatalogStorage,
  findSkillzkitPackageRoot,
} from "../lib/api/storage/fs.js";
import { FilesystemPersistentCatalogStorage } from "../lib/api/storage/fs-persistent.js";
import { MemoryCatalogStorage } from "../lib/api/storage/memory.js";
import { S3CatalogStorage } from "../lib/api/storage/s3.js";
import { createS3LikeFromAwsClient } from "../lib/api/storage/s3-aws-client.js";
import type {
  CatalogReadStorage,
  CatalogStorage,
} from "../lib/api/storage/interface.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ServerConfig {
  storage: CatalogReadStorage;
  port: number;
  /** True if storage supports writes. Drives whether contribution
   *  endpoints are mounted. */
  writable: boolean;
}

/**
 * Build a ServerConfig from process.env. Throws on unknown storage
 * spec or unrecoverable initialization errors. Async because some
 * backends (S3) load their SDK via dynamic import.
 */
export async function loadServerConfig(): Promise<ServerConfig> {
  const spec = process.env.SKILLZKIT_STORAGE ?? "fs:auto";
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  const { storage, writable } = await resolveStorage(spec);
  return { storage, writable, port };
}

async function resolveStorage(spec: string): Promise<{
  storage: CatalogReadStorage;
  writable: boolean;
}> {
  if (spec === "memory") {
    return { storage: new MemoryCatalogStorage(), writable: true };
  }

  if (spec === "fs:auto") {
    // Walk up from this file's directory to find the skillzkit
    // package root. Convenient for local dev — `SKILLZKIT_STORAGE`
    // doesn't need to be set when running inside the repo.
    const root = process.env.SKILLZKIT_PACKAGE_ROOT ?? findSkillzkitPackageRoot(__dirname);
    return { storage: new FilesystemCatalogStorage(root), writable: false };
  }

  if (spec.startsWith("fs:")) {
    const path = spec.slice("fs:".length);
    return { storage: new FilesystemCatalogStorage(path), writable: false };
  }

  if (spec.startsWith("fs-persistent:")) {
    const path = spec.slice("fs-persistent:".length);
    if (!path) {
      throw new Error(
        `SKILLZKIT_STORAGE=${spec}: fs-persistent requires a path, e.g. \`fs-persistent:/data\``,
      );
    }
    return {
      storage: new FilesystemPersistentCatalogStorage(path),
      writable: true,
    };
  }

  if (spec.startsWith("s3:")) {
    const bucket = spec.slice("s3:".length);
    if (!bucket) {
      throw new Error(
        `SKILLZKIT_STORAGE=${spec}: S3 backend requires a bucket name, e.g. \`s3:my-bucket\``,
      );
    }
    const region = process.env.AWS_REGION;
    const prefix = process.env.SKILLZKIT_S3_PREFIX ?? "v1/";
    const s3Like = await createS3LikeFromAwsClient({ bucket, region });
    return {
      storage: new S3CatalogStorage(s3Like, { prefix }),
      writable: true,
    };
  }

  throw new Error(
    `SKILLZKIT_STORAGE=${spec} is not a recognized backend. ` +
      `Valid: memory, fs:<path>, fs-persistent:<path>, s3:<bucket>`,
  );
}

/** Type-narrow check for whether a storage instance supports writes. */
export function isWritable(
  storage: CatalogReadStorage,
): storage is CatalogStorage {
  return (
    typeof (storage as CatalogStorage).putCommand === "function"
  );
}
