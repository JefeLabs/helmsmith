/**
 * AWS Lambda runtime entry. Same `app` definition as server/bun.ts,
 * different platform glue: hono/aws-lambda's `handle` adapter wires
 * Lambda's APIGatewayProxyEvent + Context to Hono's request/response.
 *
 * Lambda-specific considerations:
 *   - Cold start: scrypt at production params (~100ms) only matters
 *     for contribution flows, not reads. Read endpoints are fast
 *     enough that cold-start dominates regardless.
 *   - Storage: typically S3 in this runtime (see task #17).
 *     SKILLZKIT_STORAGE=s3:bucket-name configured via Lambda env.
 *   - Deploy: SAM/CDK/Terraform — see task #8.
 *
 * The handler is built once at module load and reused across
 * invocations within the same warm container. Don't rebuild per
 * request — defeats the purpose of warm starts.
 */

import { handle } from 'hono/aws-lambda';
import { createApp } from './app.js';
import { loadServerConfig } from './config.js';

// Top-level await - Node 20+ + AWS Lambda Node runtimes ≥ nodejs18
// support TLA. Module loads once on cold start; subsequent warm
// invocations reuse the constructed handler.
const config = await loadServerConfig();
const app = createApp({ storage: config.storage, writable: config.writable });

export const handler = handle(app);
