/**
 * Adapter that wraps an `@aws-sdk/client-s3` S3Client to satisfy the
 * S3Like interface used by S3CatalogStorage. The AWS SDK is loaded
 * via dynamic import so the rest of the skillzkit package compiles
 * and runs without the SDK installed - users who deploy to S3 install
 * the SDK as a separate step (it's a heavy dep we don't want forcing
 * on every consumer).
 *
 * Usage:
 *
 *   import { S3CatalogStorage } from "./s3.js";
 *   import { createS3LikeFromAwsClient } from "./s3-aws-client.js";
 *
 *   const s3Like = await createS3LikeFromAwsClient({
 *     bucket: process.env.S3_BUCKET!,
 *     region: process.env.AWS_REGION,
 *   });
 *   const storage = new S3CatalogStorage(s3Like, { prefix: "v1/" });
 *
 * Required IAM policy on the bucket:
 *   - s3:GetObject  on <bucket>/<prefix>*
 *   - s3:PutObject  on <bucket>/<prefix>*
 *   - (optional) s3:ListBucket - not used by core storage but
 *     useful for diagnostic tooling
 */

import {
  type S3GetResult,
  type S3Like,
  type S3PutOptions,
  type S3PutResult,
  S3NotFoundError,
  S3PreconditionFailedError,
} from "./s3.js";

export interface CreateS3LikeOptions {
  /** Required - S3 bucket name. */
  bucket: string;
  /** AWS region. Optional - falls back to the SDK's resolution chain
   *  (env vars, ~/.aws/config). */
  region?: string;
  /**
   * Optional pre-built AWS S3Client to wrap. When omitted, the
   * adapter constructs one with the given region. Pass a custom
   * client when you need request middleware, custom credentials, or
   * an S3-compatible endpoint (MinIO, R2, etc.).
   *
   * Type intentionally `unknown` - the AWS SDK's S3Client is
   * structurally complex and we only care that .send() works.
   */
  client?: unknown;
}

/**
 * Minimal type for the AWS SDK shape we use. Defined inline so we
 * don't depend on the SDK's type definitions at compile time.
 */
interface AwsLikeClient {
  send(command: AwsLikeCommand): Promise<AwsLikeResponse>;
}
interface AwsLikeCommand {
  // Marker interface; AWS SDK commands are class instances we just
  // pass through to .send(). Concrete construction happens via the
  // dynamically-imported command classes below.
}
interface AwsLikeResponse {
  Body?: AwsLikeBody;
  ETag?: string;
  // ... other fields we don't read
}
interface AwsLikeBody {
  // The SDK's StreamingBlobPayloadOutputTypes - in Node, has
  // .transformToString(); in the browser, also exposes Blob/etc.
  // We only need transformToString for our text-based payloads.
  transformToString(encoding?: string): Promise<string>;
}

/**
 * Build an S3Like adapter from AWS SDK building blocks. Loads
 * `@aws-sdk/client-s3` via dynamic import; throws a clear error if
 * the SDK isn't installed.
 */
export async function createS3LikeFromAwsClient(
  options: CreateS3LikeOptions,
): Promise<S3Like> {
  let aws: {
    S3Client: new (config: { region?: string }) => AwsLikeClient;
    GetObjectCommand: new (input: {
      Bucket: string;
      Key: string;
    }) => AwsLikeCommand;
    PutObjectCommand: new (input: {
      Bucket: string;
      Key: string;
      Body: string;
      ContentType?: string;
      IfMatch?: string;
      IfNoneMatch?: string;
    }) => AwsLikeCommand;
  };
  try {
    // Use a variable for the module specifier so TypeScript doesn't
    // statically resolve the import at compile time. The SDK is an
    // OPTIONAL runtime dep - users who never select the S3 backend
    // shouldn't be forced to install ~5MB of AWS code.
    const moduleName = "@aws-sdk/client-s3";
    aws = (await import(moduleName)) as unknown as typeof aws;
  } catch {
    throw new Error(
      "S3 backend requires `@aws-sdk/client-s3` to be installed. " +
        "Run `npm install @aws-sdk/client-s3` and retry.",
    );
  }

  const client: AwsLikeClient =
    (options.client as AwsLikeClient | undefined) ??
    new aws.S3Client({ region: options.region });
  const bucket = options.bucket;
  const { GetObjectCommand, PutObjectCommand } = aws;

  return {
    async getObject(key: string): Promise<S3GetResult> {
      try {
        const response = (await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: key }),
        )) as AwsLikeResponse;
        const body = response.Body
          ? await response.Body.transformToString("utf-8")
          : "";
        return { body, etag: stripQuotes(response.ETag) };
      } catch (err) {
        if (isAwsNotFound(err)) {
          throw new S3NotFoundError(`s3://${bucket}/${key} not found`);
        }
        throw err;
      }
    },

    async putObject(
      key: string,
      body: string,
      options: S3PutOptions = {},
    ): Promise<S3PutResult> {
      try {
        const response = (await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: "application/json",
            IfMatch: options.ifMatch,
            IfNoneMatch: options.ifNoneMatch,
          }),
        )) as AwsLikeResponse;
        return { etag: stripQuotes(response.ETag) };
      } catch (err) {
        if (isAwsPreconditionFailed(err)) {
          throw new S3PreconditionFailedError(
            `Conditional write to s3://${bucket}/${key} failed (ETag mismatch)`,
          );
        }
        throw err;
      }
    },
  };
}

/**
 * AWS returns ETags wrapped in literal double-quotes (e.g.
 * `"abc123"`). The conditional-write headers (IfMatch / IfNoneMatch)
 * accept either the quoted or unquoted form, but stripping
 * normalizes our internal representation so equality checks are
 * straightforward.
 */
function stripQuotes(etag: string | undefined): string | undefined {
  if (!etag) return undefined;
  if (etag.startsWith('"') && etag.endsWith('"')) {
    return etag.slice(1, -1);
  }
  return etag;
}

/**
 * The AWS SDK throws errors with `name` set to the AWS error code.
 * For NoSuchKey / 404 cases we want to surface a uniform
 * S3NotFoundError so S3CatalogStorage's try/catch logic stays
 * SDK-agnostic.
 */
function isAwsNotFound(err: unknown): boolean {
  if (err && typeof err === "object") {
    const name = (err as { name?: string }).name;
    return name === "NoSuchKey" || name === "NotFound";
  }
  return false;
}

function isAwsPreconditionFailed(err: unknown): boolean {
  if (err && typeof err === "object") {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.name === "PreconditionFailed") return true;
    if (e.$metadata?.httpStatusCode === 412) return true;
  }
  return false;
}
